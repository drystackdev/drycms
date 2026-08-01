# Kế hoạch nâng cấp bảo mật đăng nhập

## 1. Phạm vi

### Triển khai trong đợt này

1. CSRF protection cho request thay đổi dữ liệu.
2. Rate limit đăng nhập và chống brute-force.
3. Thu hồi toàn bộ session khi đổi mật khẩu.
4. Rotation và thu hồi secret ký JWT.
5. Access token ngắn hạn kết hợp refresh session có rotation.

### Chưa triển khai

- Audit log.
- MFA.
- Reset mật khẩu.

## 2. Trạng thái hiện tại

Hệ thống hiện có:

- JWT HS256 lưu trong cookie `HttpOnly`.
- JWT hạn 30 ngày.
- Blacklist token trong KV cho logout và đổi mật khẩu.
- `DRYCMS_SECRET_KEY` dùng làm secret ký token.
- `handleApiRequest` là middleware trung tâm để resolve session.
- KV adapter hỗ trợ local, SQLite, GitHub, GitLab, D1 và Cloudflare KV.

Các giới hạn cần xử lý:

- Chưa có CSRF token.
- Chưa có rate limit atomic.
- Blacklist hiện chỉ thu hồi từng token, chưa thu hồi toàn bộ session của user.
- JWT chỉ có một signing key.
- Chưa có refresh session riêng.

## 3. Kiến trúc mục tiêu

```text
Browser
  │
  ├─ drycms_access  : JWT HttpOnly, thời hạn 10–15 phút
  ├─ drycms_refresh : refresh token HttpOnly, thời hạn 30 ngày, rotation mỗi lần dùng
  └─ drycms_csrf    : random token, không HttpOnly để client đọc và gửi bằng header
        │
        ▼
handleApiRequest
  ├─ kiểm tra CSRF cho request thay đổi dữ liệu
  ├─ verify JWT bằng key ring
  ├─ kiểm tra blacklist/session/user revocation
  └─ chuyển request vào route
        │
        ▼
Auth security store
  ├─ refresh sessions
  ├─ user auth version / revokedAfter
  └─ rate-limit counters
```

Access token chỉ chứa thông tin cần cho authorization:

```ts
{
  iss: "drycms",
  aud: "drycms-admin",
  sub: "<userId>",
  sid: "<sessionId>",
  jti: "<tokenId>",
  iat: number,
  exp: number,
  kid: "<signing-key-id>"
}
```

Refresh token là chuỗi random opaque, không chứa user data. Server chỉ lưu
hash của refresh token.

## 4. Phase 0 — Chuẩn hóa contract và config

### Config mới

Thêm nhóm cấu hình auth, với giá trị mặc định an toàn:

```ts
auth: {
  accessTtlSeconds: 900,
  refreshTtlSeconds: 2_592_000,
  refreshRotation: true,
  csrfCookieName: "drycms_csrf",
  securityStore: "sqlite" | "D1" | "KV" | ...,
  loginRateLimit: {
    windowSeconds: 900,
    maxAttempts: 10,
    blockSeconds: 900,
  },
}
```

Không dùng GitHub/GitLab làm security store mặc định vì độ trễ và tính nhất
quán không phù hợp với session/rate limit.

### Secret key ring

Thay vì chỉ đọc một secret:

```text
DRYCMS_JWT_ACTIVE_KID=2026-08
DRYCMS_JWT_KEYS_JSON={"2026-08":"...","2026-07":"..."}
```

Yêu cầu:

- Active key dùng để ký token mới.
- Các key còn trong key ring chỉ dùng verify token cũ trong thời gian chuyển tiếp.
- Không log giá trị secret.
- Secret phải có entropy tối thiểu 32 bytes.
- Nếu thiếu hoặc yếu secret thì server fail fast khi khởi động.

## 5. Phase 1 — Access token và refresh session

### Session record

Lưu trong security store, namespace `auth-sessions`:

```ts
interface AuthSessionRecord {
  sessionId: string;
  userId: number;
  refreshTokenHash: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  revokeReason?: "logout" | "password-change" | "rotation" | "admin";
  replacedBy?: string;
  userAgentHash?: string;
}
```

### Login

1. Xác thực email/password.
2. Kiểm tra rate limit trước và sau khi xác thực thất bại.
3. Tạo `sessionId` và refresh token random.
4. Lưu hash refresh token với durability `sync`.
5. Cấp access JWT 10–15 phút.
6. Set access cookie, refresh cookie và CSRF cookie.

### Refresh

Tạo `POST /api/auth/refresh`:

1. Đọc refresh cookie.
2. Hash token và tìm session.
3. Từ chối session hết hạn/đã revoke/đã dùng lại.
4. Revoke refresh token hiện tại.
5. Tạo refresh token mới và liên kết bằng `replacedBy`.
6. Cấp access JWT mới.
7. Set lại CSRF cookie nếu cần.

Nếu phát hiện refresh token đã bị dùng lại, revoke toàn bộ session chain của
user/session để xử lý token theft.

### Logout

- Revoke refresh session hiện tại.
- Blacklist access JWT hiện tại đến khi hết hạn.
- Xóa cả ba cookie.

## 6. Phase 2 — Thu hồi toàn bộ session khi đổi mật khẩu

Lưu record theo user trong namespace `auth-users`:

```ts
interface AuthUserSecurityRecord {
  userId: number;
  sessionVersion: number;
  revokedAfter?: string;
  updatedAt: string;
}
```

Khi đổi mật khẩu:

1. Xác thực current password.
2. Tăng `sessionVersion` hoặc cập nhật `revokedAfter` trước khi ghi password.
3. Revoke toàn bộ refresh sessions của user.
4. Blacklist access token hiện tại.
5. Ghi password mới.
6. Cấp một session mới cho thiết bị hiện tại.

Khi resolve JWT:

- Kiểm tra `sid` còn tồn tại và chưa bị revoke.
- Kiểm tra `iat` không nhỏ hơn `revokedAfter`.
- Kiểm tra session version khớp.

Nếu security store không truy cập được, request phải fail closed với lỗi
`503`, không được coi token là hợp lệ.

## 7. Phase 3 — CSRF protection

### Cơ chế

Dùng double-submit cookie:

- `drycms_csrf`: random token, không HttpOnly.
- Client đọc cookie và gửi lại bằng header `X-CSRF-Token`.
- Server so sánh constant-time cookie/header.

### Request cần kiểm tra

Áp dụng cho:

- `POST`
- `PUT`
- `PATCH`
- `DELETE`

Ngoại lệ có chủ đích:

- `POST /api/auth/login` khi chưa có session.
- `POST /api/auth/register-first-admin` khi chưa setup.

Các request auth khác vẫn phải có CSRF nếu đang dùng cookie session.

### Client

Tạo wrapper `authFetch()`:

- Tự đọc CSRF cookie.
- Gắn `X-CSRF-Token` cho request thay đổi dữ liệu.
- Nếu nhận `401`, gọi refresh/session flow một lần rồi retry có giới hạn.
- Không lưu access/refresh token trong `localStorage`.

## 8. Phase 4 — Rate limit và chống brute-force

### Key

Rate limit theo nhiều chiều:

```text
login:ip:<ip>
login:email:<normalizedEmail>
login:ip-email:<ip>:<emailHash>
```

### Quy tắc mặc định

- 5 lần thất bại / 5 phút / email.
- 20 lần thất bại / 15 phút / IP.
- Sau ngưỡng: block 15 phút.
- Login thành công xóa hoặc giảm counter theo email.
- Response vẫn dùng thông báo chung `Invalid email or password`.

### Primitive bắt buộc

Không dùng chuỗi `get → set` thông thường cho counter vì có race condition.
Thêm một trong các cơ chế:

- SQLite/D1: `INSERT ... ON CONFLICT DO UPDATE` trong transaction.
- Cloudflare KV: dùng Durable Object hoặc service chuyên counter nếu cần
  atomic tuyệt đối.
- Local: lock trong process, chỉ dùng cho development.

GitHub/GitLab không được dùng cho rate limit production.

## 9. Phase 5 — Secret rotation

### Verify

1. Đọc `kid` từ JWT header.
2. Chọn đúng key trong key ring.
3. Chỉ chấp nhận `alg=HS256`, `typ=JWT`, `iss` và `aud` đúng.
4. Từ chối key không tồn tại.

### Quy trình xoay key

1. Tạo key mới.
2. Đưa key cũ vào key ring với trạng thái verify-only.
3. Đặt key mới làm active.
4. Deploy.
5. Chờ quá access-token TTL và thời gian refresh grace period.
6. Xóa key cũ khỏi key ring.

Nếu key bị lộ:

- Xóa key ngay khỏi key ring.
- Xóa/revoke toàn bộ refresh sessions.
- Tăng user/session revocation version.
- Bắt tất cả user đăng nhập lại.

## 10. Phase 6 — API và middleware

### Route mới

```text
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
POST /api/auth/update-profile
GET  /api/auth/session
```

### Middleware order

```text
1. Parse request/cookie
2. Bỏ qua static asset và public auth endpoints
3. CSRF validation cho mutation
4. Resolve access JWT
5. Check user/session revocation
6. Route-level authorization
7. Handler
```

Không đưa password, refresh token, raw IP hoặc secret vào log response/error.

## 11. Kiểm thử bắt buộc

### JWT/session

- Access token hết hạn bị từ chối.
- `kid` không tồn tại bị từ chối.
- Sai `iss`, `aud`, `alg`, signature đều bị từ chối.
- Refresh rotation hợp lệ chỉ dùng được một lần.
- Reuse refresh token revoke session chain.
- Logout từ chối access token và refresh token tương ứng.
- Đổi password từ chối mọi session cũ của cùng user.
- User khác không bị ảnh hưởng.

### CSRF

- Mutation thiếu header bị `403`.
- Cookie/header khác nhau bị `403`.
- Token đúng được chấp nhận.
- Login/register không bị khóa bởi CSRF khi chưa có session.

### Rate limit

- Counter tăng atomic khi request đồng thời.
- Đúng ngưỡng thì block.
- Hết window thì cho thử lại.
- IP/email khác nhau không làm reset sai counter.
- Không tiết lộ email có tồn tại hay không.

### Integration/e2e

- Login → refresh → gọi API.
- Mở nhiều tab.
- Logout một tab và kiểm tra tab khác bị từ chối sau refresh/resolve.
- Đổi password và kiểm tra toàn bộ session cũ.
- Restart server không làm mất refresh session.
- Rotate key không làm token trong grace period hỏng.

## 12. Lộ trình triển khai

### Milestone A — nền tảng

- Auth config.
- Key ring.
- Session record và security store.
- Access token TTL ngắn.
- Refresh endpoint.

### Milestone B — kiểm soát request

- CSRF middleware.
- `authFetch()` client.
- Xử lý `401` và refresh một lần.

### Milestone C — thu hồi và chống brute-force

- User revocation version.
- Revoke toàn bộ session khi đổi password.
- Atomic rate limit.

### Milestone D — vận hành

- Key rotation procedure.
- Migration cookie cũ sang cookie mới trong một lần deploy.
- E2E test.
- Tài liệu biến môi trường và rollback.

## 13. Tiêu chí hoàn thành

- Không còn JWT 30 ngày dùng trực tiếp làm session duy nhất.
- Access token tối đa 15 phút.
- Refresh token được rotate và lưu hash.
- Logout/đổi password revoke đúng phạm vi.
- Mọi mutation có CSRF protection.
- Login brute-force bị giới hạn atomic.
- Có thể rotate key mà không phải deploy code.
- Test unit/integration/e2e cho các case bảo mật chính đều pass.
