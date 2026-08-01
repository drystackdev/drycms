# Key Value system

## Plan

- Rà soát kiến trúc hiện tại và các adapter liên quan.
- Viết kế hoạch chi tiết cho core memory store, persistence coordinator, sáu adapter, lifecycle và kiểm thử.
- Đã bắt đầu triển khai MVP; file này tiếp tục là status tracking cho các phase còn lại.

## Status

- Đã đọc `docs/README.md`, `docs/ARCHITECTURE.md` và `docs/CODING-PRINCIPLES.md`.
- Đã kiểm tra storage factory, config resolution, SQLite driver, D1 driver và Fetch-shaped server context.
- Đã viết kế hoạch tại `docs/key-value-plan.md`.
- Đã cập nhật quyết định branch: không dùng `GITHUB_BRANCH`/`GITLAB_BRANCH`;
  branch mặc định theo subsystem (`storage`, `icons`, `content`, `richtext`).
- Đã triển khai `branch?: string` cho các file-backed config hiện tại và cập
  nhật resolver theo thứ tự config → tên subsystem.
- Đã sửa GitHub/GitLab auto-create branch để branch mới bắt đầu với tree rỗng,
  không kế thừa dữ liệu từ branch chính.
- Đã thêm test cho branch cấu hình thắng branch từ environment.
- Đã cập nhật `.env.example` và tài liệu kiến trúc, bỏ branch dùng chung khỏi
  danh sách environment.
- Đã chốt UI Key Value chỉ dành cho Super Admin: REST pagination + polling
  5–10 giây với `revision/ETag`; chưa dùng WebSocket, SSE hoặc long response.
- Đã triển khai `src/kv/`: core memory store, TTL/idle cleanup, giới hạn
  memory, dirty queue, async/sync flush, local/SQLite/GitHub/GitLab/D1/KV
  adapter và test round-trip/restart.
- Đã thêm config `kv`, route `/api/key-value`, trang `/key-value`, Super Admin
  authorization, ETag và polling UI.
- Đã thêm blacklist session bền vững trên KV: logout thu hồi token hiện tại;
  đổi mật khẩu thu hồi token cũ trước khi ghi mật khẩu mới; mọi request đều
  kiểm tra blacklist trong bước resolve session.
- Đã chuyển session token tự định dạng sang JWT chuẩn HS256 (`alg`, `typ`,
  `iss`, `sub`, `iat`, `exp`, `jti`), ký bằng `DRYCMS_SECRET_KEY`; token cũ
  không còn được chấp nhận.
- Đã thêm guard trực tiếp tại trang Key Value và xử lý `401` để SPA tự chuyển
  về `/login` khi session/JWT không còn hợp lệ.
- Đã thêm HTTP page guard cho dev và production Node server; truy cập trực tiếp
  `/key-value` không có JWT hợp lệ nhận `302` về `/login` trước khi nhận SPA shell.
- Các thay đổi đang có trước task trong `src/pages/ContentTypeEditor.tsx` và `src/pages/content-type-editor/FieldsList.tsx` được giữ nguyên.

## Speed

- Hoàn thành phần khảo sát và lập kế hoạch trong một lượt.
- `bun run typecheck` pass.
- `src/storage/github.test.ts` và `src/storage/gitlab.test.ts`: 68/68 pass.
- `src/kv/kv.test.ts`: 6/6 pass. `bun run build` pass cho client và SSR.
- Đã sửa test env GitHub để biểu diễn đúng biến môi trường rỗng; test secret
  thiếu cũng cô lập khỏi `.env` local.
- Toàn bộ test suite pass: 53 files, 681 tests; `bun run typecheck`, build
  client/SSR và `git diff --check` đều pass.

## Auth scope decision

- Tạm thời chưa triển khai Audit log, MFA và Reset mật khẩu.
- Phạm vi auth ưu tiên còn lại: CSRF, rate limit/chống brute-force, thu hồi
  toàn bộ session khi đổi mật khẩu, secret rotation và access/refresh token.
- Kế hoạch chi tiết đã ghi tại `docs/auth-security-plan.md`.
- Đã bắt đầu Milestone A: access JWT giảm còn 15 phút, thêm `sid`/`aud`,
  security store cho refresh sessions, refresh token rotation cơ bản và
  thu hồi toàn bộ session theo user khi đổi mật khẩu.
- Đã triển khai CSRF double-submit cookie/header cho API mutation, wrapper
  fetch same-origin tự gắn `X-CSRF-Token`, và sửa Node bridge gửi nhiều
  `Set-Cookie` độc lập.
- Đã thêm rate limit login theo email/IP với cửa sổ, thời gian block, TTL
  trong security store và lock chống race trong cùng process.
- Đã thêm JWT key ring cơ bản qua `DRYCMS_JWT_KEYS_JSON` và
  `DRYCMS_JWT_ACTIVE_KID`; token mới dùng active key, token cũ trong key ring
  vẫn được verify.
- Đã thêm phát hiện refresh token reuse: token đã rotate nhưng bị dùng lại sẽ
  revoke toàn bộ session chain của user; refresh rotation có lock theo token
  trong cùng process.
- Đã thêm counter atomic cho SQLite/D1 bằng bảng counter và UPSERT; các backend
  không có primitive atomic tiếp tục dùng process lock an toàn cho single-node.
- Đã thêm test SQLite atomic counter và test JWT key-ring rotation.
- Đã nối client tự refresh access token một lần khi nhận `401`, có coalescing
  khi nhiều request hết hạn đồng thời; refresh thất bại mới chuyển về login.
- Đã bổ sung test cases cho auth security session/reuse, rate limit, CSRF,
  JWT key rotation và SQLite atomic counter. Nhóm test mới đạt 25/25.
