# Kết nối MCP tới drycms (AI client ngoài đọc/ghi content) + xem lại hoạt động

Nhu cầu: cho MCP client bên ngoài (Claude Desktop, Claude Code...) kết nối vào
drycms để đọc/ghi content qua đúng các hành động Magic Chat đã có
(`fetch`/`create`/`fields`), xác thực theo đúng user + permission thật (không
phải cơ chế riêng), và cho user xem lại được AI vừa làm gì qua UI admin.

## Plan

3 phase độc lập theo thứ tự ưu tiên, ship rời nhau được.

### Phase 1 — Personal Access Token (PAT): xác thực MCP theo đúng user

Hiện trạng: mọi route qua `handler.ts` xác thực bằng cookie `drycms_session`
(`session.ts`'s `resolveSession`), dựng ra `DryRouteContext.session:
SessionPayload | null` (`context.ts:26`) mà mọi handler downstream (kể cả
`checkAccess` ở `content-entries.ts:93`) dựa vào. MCP client không phải
browser nên không có cookie này — cần một nguồn xác thực song song, KHÔNG sửa
lại logic phân quyền đã có.

1. ✅ 2 namespace KV mới trong `auth-security.ts`, cạnh
   `SESSION_NAMESPACE`/`REFRESH_NAMESPACE`/`USER_NAMESPACE`: `MCP_TOKEN_NAMESPACE`
   (key = hash(token) → `{tokenId, userId}`, lookup O(1) lúc xác thực) và
   `MCP_TOKEN_INDEX_NAMESPACE` (key = `user-<id>` → `McpTokenMeta[]`, danh
   sách Profile đọc/revoke - không chứa hash/token thật). `createMcpToken`/
   `listMcpTokens`/`revokeMcpToken`/`resolveMcpToken` - song song
   `createAuthSession`/`revokeAuthSession`, tái dùng `storeFor(env)`/`hash()`
   sẵn có. Token dài hạn, không TTL (không có chu kỳ refresh như session).
2. ✅ `session.ts`: thêm `readBearerToken(request)` (đọc header
   `Authorization: Bearer <token>`). KHÔNG đặt `resolveMcpSession` ở đây như
   dự tính ban đầu - `SessionPayload` cần `name`/`email` mà `resolveMcpToken`
   chỉ trả `userId`; tra tươi từ DB cần `DryRouteContext` đầy đủ
   (`getContentAdapters`), nên việc này chuyển sang `handler.ts` (bước 3) sau
   khi context đã dựng xong, thay vì tự tạo một context giả ở `session.ts`.
   Hệ quả tốt hơn dự tính: `name`/`email` của một phiên PAT LUÔN tươi (đọc
   thẳng từ entry `user` mỗi request), không bị "đông cứng" như lo ngại ban
   đầu về JWT-style embedding.
3. ✅ `handler.ts`: khi `segment === "mcp"` và chưa có session từ cookie, đọc
   bearer token → `resolveMcpToken` → tra `user` entry tươi → gán vào
   `context.session`. `checkAccess`/mọi permission check downstream không đổi
   gì - vẫn tra quyền theo `session.id` như cũ.
4. ✅ `csrf.ts`: `requiresCsrf` trả `false` cho segment `mcp` - xác thực bằng
   bearer token, không phải cookie, nên CSRF (double-submit cookie) không áp
   dụng.
5. ✅ UI: mục "API Token" trong `Profile.tsx` (`McpTokensSection`) - form
   Generate (hiện token đúng 1 lần, nút Copy, giống flow secretkey), danh
   sách token (label, createdAt, lastUsedAt) + nút Revoke từng cái (qua
   `ConfirmDialog`). Route `GET/POST /api/auth/mcp-tokens`,
   `DELETE /api/auth/mcp-tokens/:tokenId` (thêm vào `routes/auth.ts` theo
   đúng pattern slug-endpoint sẵn có, cộng 1 export `DELETE` mới).
6. ✅ Thêm ngoài kế hoạch ban đầu: link tắt "Connect an MCP client" (icon
   khoá) trong header của `MagicChat.tsx`, mở `/profile` ở tab mới - không
   nhúng logic sinh token vào Magic Chat (xem thảo luận trong chat), giữ
   Profile là nơi quản lý token duy nhất.

### Phase 2 — MCP server: expose fetch/create/fields thành MCP tools

Hiện trạng: `ai-magic-write.ts`'s `streamMagicWrite` đã tách sẵn 3 hành động
độc lập, mỗi hàm tự re-check `checkAccess` cho đúng type đang thao tác (không
mượn quyền entry khác) — `executeMagicFetch` (`ai-magic-write-fetch.ts:182`,
gộp cả 3 nguồn `entries`/`entry`/`media`/`types`), `executeMagicCreate`
(`ai-magic-write-create.ts:57`), và hàm áp field vào entry (cùng
`ai-magic-write.ts`). Đây chính xác là các "tool" MCP cần — chỉ cần bọc lại
chữ ký, không viết lại logic nghiệp vụ hay logic phân quyền.

1. ĐỔI so với kế hoạch ban đầu: KHÔNG thêm dependency
   `@modelcontextprotocol/sdk`. Lý do đảo quyết định: SDK chính thức dựng
   quanh transport kiểu Node request/response, không khớp shape
   Fetch-API (`Request` in, `Response` out) toàn bộ server này đang dùng
   (`context.ts`'s `DryRouteHandler`) - và codebase này vốn đã tự ký JWT tay
   (`lib/session-token.ts`) thay vì dùng package `jsonwebtoken` với đúng lý
   do tương tự. Giao thức Streamable HTTP ở chế độ *stateless* (không
   `Mcp-Session-Id`, không SSE server-push - mỗi tool call là 1 request độc
   lập, tự xác thực lại bằng bearer token) chỉ là JSON-RPC 2.0 qua POST, đủ
   nhỏ để tự viết tay mà không phải đánh đổi độ chính xác giao thức.
2. ✅ Route mới `src/server/routes/mcp.ts` - `POST` duy nhất (GET/DELETE
   không cần vì stateless, tự 405 qua route table sẵn có), tự dựng JSON-RPC
   dispatcher (`initialize`, `ping`, `tools/list`, `tools/call`,
   `notifications/*`). 6 tool, ĐỔI TÊN so với kế hoạch ban đầu (đặt tên rõ
   theo tác vụ thay vì 1 tool `fetch` đa năng - dễ dùng hơn cho MCP client):
   `list_content_types`/`list_entries`/`get_entry`/`list_media` (bọc thẳng
   `executeMagicFetch`, chỉ khác `source`), `create_entry` (KHÔNG bọc
   `executeMagicCreate` - hàm đó giới hạn theo "chỉ tạo type liên quan tới 1
   entry đang mở", không khớp ngữ cảnh MCP không mở entry nào; viết lại phần
   check quyền + `applyMagicWriteFields` trực tiếp, cùng logic lõi),
   `update_entry_fields` (mới, Magic Chat chưa từng cần vì `kind: fields` xưa
   nay client tự PUT sau - MCP cần ghi thẳng nên gọi `applyMagicWriteFields`
   + `updateEntry`/`saveSingletonEntry` trực tiếp). Cả `create_entry`/
   `update_entry_fields` chỉ nhận field vô hướng (text/richtext/number/
   boolean/date/select) - relation/image bị bỏ qua có chủ đích, giống đúng
   giới hạn `executeMagicCreate` đã có sẵn cho entry mới tạo.
3. ✅ Đăng ký `mcp` trong `API_ROUTES` (`handler.ts`).

### Phase 3 — Xem lại hoạt động AI qua MCP trong UI admin (chưa realtime)

Hiện trạng: `magic-chat-store.ts` chỉ lưu lịch sử vào IndexedDB CỤC BỘ trong
đúng 1 tab trình duyệt (comment dòng 6-7: "no cross-tab `BroadcastChannel`
sync") — không có gì lưu phía server, nên không có gì để 1 trang admin khác
"xem lại" một phiên chạy từ MCP client bên ngoài.

1. ✅ Mỗi lần 1 tool ở Phase 2 chạy xong (`mcp.ts`'s `callTool`), ghi 1 dòng
   log vào KV (namespace `mcp-activity`, cùng store `auth-security.ts`'s
   `getAuthSecurityStore` đã export sẵn - không dựng store riêng) —
   `{id, tool, summary, isError, timestamp}`, tái dùng đúng `outcome.text`
   tool đã trả (không format lại). Cùng shape "1 mảng JSON theo user, cắt
   còn 50 dòng mới nhất" như `MCP_TOKEN_INDEX_NAMESPACE` đã dùng cho token -
   không phải DB thật, không cần schema riêng. Ghi fire-and-forget
   (`void`) - lỗi ghi log không bao giờ làm hỏng response của tool call.
2. ✅ KHÔNG làm trang admin riêng như dự tính ban đầu ("trang mới hoặc tab
   Dashboard") - đặt thẳng vào `Profile.tsx` (`McpActivitySection`, cạnh
   `McpTokensSection`) thay vì thêm route/nav mới - cùng lý do đã chọn hướng
   này cho link tắt ở Magic Chat: giữ mọi thứ liên quan MCP tập trung 1 chỗ,
   không mở rộng router/sidebar cho 1 tính năng phụ. Poll
   `GET /api/mcp/activity` mỗi 5s, render list đơn giản (badge tên tool +
   summary + timestamp), không dùng `since` (danh sách đã tự cắt 50 dòng,
   trả nguyên mỗi lần - không cần phân trang).
3. ✅ Không làm SSE/WebSocket broadcast realtime, đúng như dự tính - polling
   là đủ cho "biết AI vừa làm gì" mà không cần đầu tư hạ tầng pub-sub.

## Status

**Cả 3 phase xong (2026-08-11).** `typecheck` sạch, `bun run test` không có
failure mới sau cả 2 vòng implement (4 failure hiện có trong suite đều
pre-existing, xác nhận bằng `git stash` trước khi bắt đầu - không liên quan
tới thay đổi này: `component-preview.test.ts` (CSS background-color),
`sitemap.test.ts` (route tree), 2 case trong `auth.test.ts` thiếu field
`avatar` trong object kỳ vọng).

**Verify thật, không chỉ test suite**: chạy trực tiếp lên dev server thật
đang sống (`.dry/content.sqlite` LIVE, tài khoản admin thật) qua `curl`, mô
phỏng đúng luồng 1 MCP client sẽ đi qua - KHÔNG chỉ chạy unit test:
- Login → tạo PAT thật qua `POST /api/auth/mcp-tokens` → dùng đúng token đó
  (không cookie) gọi `/api/mcp`: `initialize` → `notifications/initialized`
  (202 rỗng) → `tools/list` (đúng 6 tool) → `tools/call list_content_types`
  (trả đúng danh sách content type thật của DB).
- Xác nhận đúng biên bảo mật: không có `Authorization` → 401; token rác →
  401; `create_entry` nhắm vào `user` (type bị khoá Magic) → bị từ chối
  đúng message, không tạo được gì.
- Revoke token → gọi lại ngay lập tức → 401 (thu hồi có hiệu lực tức thì,
  không cache).
- Phase 3: gọi vài tool call → poll `GET /api/mcp/activity` → thấy đúng
  log, đúng thứ tự mới nhất trước, đúng cờ `isError`.

⚠️ **Phát hiện lúc verify - HMR miss lặp lại đúng pattern đã biết**
(xem memory `feedback_server_hmr_new_registry_entries`): dev server đã chạy
sẵn ~37 phút không tự nhận export `GET` MỚI thêm vào `mcp.ts` (báo
`405 Method not allowed`), dù export `POST` cùng file đã sửa nhiều lần vẫn
hot-reload bình thường suốt session. Restart `bun run dev` thì nhận đúng
ngay. Không phải lỗi code - xác nhận lại: **thêm 1 EXPORT MỚI vào 1 module
server đã import sẵn** (không riêng gì field-type registry như ghi nhận lần
trước) cần restart dev server, sửa NỘI DUNG một export đã có thì hot-reload
bình thường.

File thay đổi/thêm mới: `server/auth-security.ts`, `server/session.ts`,
`server/csrf.ts`, `server/handler.ts`, `server/routes/auth.ts`,
`server/routes/mcp.ts` (mới), `pages/Profile.tsx`,
`pages/content-entry-editor/MagicChat.tsx`.

Chưa làm: chưa có unit test file riêng cho `mcp.ts` (logic tái dùng gần hết
từ code đã test sẵn - `executeMagicFetch`, `applyMagicWriteFields`,
`checkAccess` - nhưng dispatcher JSON-RPC, `runCreateTool`/`runUpdateTool`,
`recordMcpActivity` tự viết thì chưa có test riêng, mới chỉ verify bằng
curl thủ công như trên). Cũng chưa cắm thật vào Claude Desktop/Claude Code -
verify bằng curl mô phỏng đúng wire protocol, nhưng chưa phải 1 phiên MCP
client GUI thật.

⚠️ Có phiên khác đang sửa repo đồng thời trong lúc làm việc (`git log` xuất
hiện thêm commit `b44a77a` không có lúc bắt đầu phiên này, cộng vài file
uncommitted khác không liên quan tới MCP - `components/Editer/Editer.tsx`,
`components/Editer/tailwind-completions.ts`, `server/app-router/assets.ts`)
- không đụng tới (xem [[feedback_concurrent_repo_editing]] trong memory).
Việc restart dev server (để fix HMR miss ở trên) có thể đã làm gián đoạn vài
giây cho phiên đó nếu họ đang xem trình duyệt lúc đó.

## Speed

Xong trong 1 phiên làm việc (2026-08-11): lên kế hoạch → code Phase 1+2 →
verify → code Phase 3 → verify lại, tất cả trong cùng 1 lượt. Việc còn lại
(unit test riêng cho mcp.ts, verify bằng MCP client GUI thật) chưa có mốc
thời gian - làm khi được yêu cầu tiếp.
