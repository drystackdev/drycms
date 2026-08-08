# Worker request cost (D1/R2 per page view)

## Plan

Đo được (đọc code, production path `entry-worker.ts` → `page-handler.ts`):
một lượt xem trang public **đã có cache HTML** vẫn tốn **~13 query D1 tuần tự
+ 1 R2 GET**. Trần thật của hệ thống không phải quota mà là D1
(single-threaded, ~1000 query/s) ⇒ ~50-80 req/s.

Phân rã 13 query của `GET /` (anonymous, prod, cache HIT):

| Nguồn | Query |
|---|---|
| `d1.ts` `ensureBootstrap()` (2 CREATE TABLE + 1 CREATE INDEX + SELECT name + INSERT super-admin) | 5 |
| `listContentTypes()` SELECT definition | 1 |
| `findRedirectResponse()` (chạy vô điều kiện, trước cả cache read; index-backed nên rẻ về rows-read, vẫn là 1 round trip) | 1 |
| `entries-d1.ts` `ensureVersionsTable()` | 1 |
| `readPageCache()` → 1 `getResourceVersion` cho mỗi type đã touch (~5) | 5 |

Nguyên nhân gốc: adapter D1 được tạo **mỗi request**
(`content-adapters.ts`'s `requestAdapters` WeakMap keyed theo route context),
nên closure `bootstrapped`/`versionsBootstrapped` không bao giờ dùng lại giữa
các request trong cùng isolate.

Việc cần làm:

1. **Memo bootstrap theo binding, không theo request** - `WeakMap<D1Database,
   Promise<void>>` ở module scope, xoá khỏi map khi promise reject để request
   sau retry. Cắt 6 query (trừ request đầu tiên của mỗi isolate).
2. **Gộp version check thành 1 query** - thêm
   `getResourceVersions(types)` vào `ContentEntryEngineAdapter` (`WHERE
   resource IN (...)`), dùng trong `readPageCache`/`writePageCache`. Cắt
   ~5 query.
3. **Dời `findRedirectResponse` xuống sau `readPageCache`** - cache hit là
   bằng chứng path đó là route thật, không cần hỏi bảng `redirect`. Cắt 1
   query và thu hẹp luôn cái bẫy "slug trùng segment cuối" mà comment trong
   `page-handler.ts` đã tự nhận. (Cột `from` đã có `ux_redirect_from` -
   query này rẻ về rows-read, cái tiết kiệm được là 1 round trip D1, không
   phải một full scan như ước lượng ban đầu.)
4. **Cache HTML ở edge (Cache API)** - `caches.default` trong
   `entry-worker.ts`, chỉ cho GET không có cookie VEI/admin, TTL cấu hình qua
   `pagesCache.edgeTtl` (mặc định 60s). Lượt xem trúng edge cache = 0 D1, 0
   R2, gần như 0 CPU.

Không làm (và vì sao):

- Chuyển pages-cache R2 → KV: sau (4) thì R2 GET chỉ còn xảy ra ở lượt
  miss edge cache, lợi ích còn nhỏ so với rủi ro đổi backend.
- D1 read replication / Smart Placement: cấu hình hạ tầng (dashboard +
  Sessions API), không phải thay đổi code trong repo này - để user quyết.

## Status

- [x] 1. Bootstrap memo theo binding (`engine/d1.ts`, `engine/entries-d1.ts`)
- [x] 2. `getResourceVersions` batched (types + sqlite + d1 + pages-cache)
- [x] 3. Redirect check sau cache read (`page-handler.ts`)
- [x] 4. Edge cache (`app-router/edge-cache.ts` + `entry-worker.ts` +
      `options.ts` `pagesCache.edgeTtl`)
- [x] Unit test + typecheck

Kết quả: cache HIT còn **2 query D1 + 1 R2 GET** (từ 13 + 1); trúng edge
cache thì **0 D1 + 0 R2**.

## Speed

Đã verify:

- `bun run typecheck` sạch; `bunx vitest run` cho `edge-cache.test.ts` (13
  test mới), `options.test.ts`, `pages-cache.test.ts` đều pass.
- 16 test fail còn lại (`seed`, `dry-reader`, `entries-sqlite`, `sqlite`,
  `content-types`) là **có sẵn từ trước** - đã chạy lại đúng bộ đó trên một
  git worktree ở HEAD sạch: 17 fail cùng chỗ. Không liên quan thay đổi này
  (chúng đến từ seed types trùng tên với fixture của test).
- `vite build --ssr entry-worker.ts` build được, edge-cache có trong bundle.
- Dev server (Node): `/`, `/about`, `/blogs`, `/contact`, `/sitemap.xml` →
  200, URL lạ → 404, và redirect vẫn 301 đúng đích sau khi đổi thứ tự
  (test bằng 1 row `redirect` tạm, đã xoá lại, `count(*) = 0`).

Cảnh báo cần nói với user:

- **Cache API không hoạt động trên `*.workers.dev`** - chỉ chạy khi Worker
  phục vụ qua custom domain/route. Nếu site đang chạy trên workers.dev thì
  mục (4) là no-op (an toàn, không lỗi) cho tới khi gắn domain.
- Edge cache mặc định 60s ⇒ nội dung sửa xong hiện ra chậm nhất sau 60s cho
  khách ẩn danh. Người đang đăng nhập (cookie VEI/admin) luôn bypass, thấy
  ngay. Đặt `pagesCache: { edgeTtl: 0 }` trong `dry.config.ts` để tắt.
