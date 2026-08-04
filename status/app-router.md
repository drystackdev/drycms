# App Router (`src/apps`) - thực thi Giai đoạn 1 + Tailwind (Giai đoạn 2)

## Plan

Xem `plans/app-router.md` cho toàn bộ kế hoạch (4 giai đoạn + 2 cơ chế
cache). File này track việc thực thi - Giai đoạn 1 (SSR streaming qua
adapter, file-based routing, `pages-cache`) đã xong đầy đủ; phần Tailwind
v4 của Giai đoạn 2 cũng đã xong (client hydration của Giai đoạn 2 thì
chưa).

Bước theo đúng thứ tự `plans/app-router.md`'s Giai đoạn 1:
1. Spike `renderToReadableStream` + async component.
2. `route-tree.ts` + `match.ts` + unit test.
3. `render.ts` + `dry-global-plugin.ts`.
4. `page-handler.ts`.
5. `pages-cache` (`DryPagesCacheOption` + `touchedTypes`).
6. Nối `scripts/dev-server.mjs` + `dry.generated.d.ts` cache mirror.
7. Test thủ công qua dev server thật.

## Status

Giai đoạn 1 xong. Tất cả 7 bước đã code + test.

- [x] Bước 1: Spike `renderToReadableStream` + async component -
      **kết quả: không dùng được**, đọc source xác nhận nó chỉ hỗ trợ
      Suspense-style (component throw promise), không await 1 async
      function component trả về bình thường. Đổi hướng: `render.ts` tự
      resolve cây bottom-up qua `renderToStringAsync` (đã verify đúng),
      giữ streaming thật ở 1 ranh giới rẻ tiền (head tĩnh trước, body sau).
      Test: `render-stream.spike.test.ts` (2 test, ghi lại làm tài liệu).
- [x] Bước 2: `route-tree.ts` (`buildRouteTree`/`discoverRoutes`, thuần +
      `import.meta.glob`) + `match.ts` (độ ưu tiên tĩnh > `[dynamic]` >
      `[...catchAll]`, nested layout root-to-leaf). Test: `match.test.ts`
      (7 case).
- [x] Bước 3: `render.ts` (2-chunk stream, params qua props không phải
      `Dry.params`) + `dry-global-plugin.ts` (inject `import { dry }`,
      đăng ký vào `vite.config.ts`). Test: `render.test.ts` (2 case),
      `dry-global-plugin.test.ts` (4 case).
- [x] Bước 4: `page-handler.ts` - `handlePageRequest`, dùng
      `getContentAdapters()` có sẵn (kế thừa quy tắc D1-per-request), chỉ
      xét path ngoài admin. Test: `page-handler.test.ts` (2 case).
- [x] Bước 5: `pages-cache.ts` (đọc/ghi qua `StorageAdapter`, root
      `.dry/pages-cache`) + `build-id.ts` (`BUILD_ID` per-process) +
      `touchedTypes` thêm vào `DryRequestContext`/`dry-reader.ts` (3 điểm
      ghi, additive, không đổi test cũ). `DryPagesCacheOption` trong
      `options.ts`. Test: `pages-cache.test.ts` (5 case: miss rỗng, hit,
      miss khi version đổi, miss khi buildId lệch, ghi đè cùng path) +
      3 case `touchedTypes` mới trong `dry-reader.test.ts`.
- [x] Bước 6: `scripts/dev-server.mjs` - nhánh `tryServeAppRouterPage`
      (load `page-handler.ts` **fresh mỗi request** qua `ssrLoadModule`,
      không cache như các module server khác - để "live preview qua vite"
      thật sự sống); path ngoài admin không khớp route trả 404 thật (đổi
      hành vi cũ). Cùng lúc: `types-cache.ts` (`writeGeneratedDryTypes`,
      ghi cả `.dry/types-cache` lẫn file thật) - cập nhật cả
      `dev-server.mjs`'s startup hook lẫn `scripts/dry-generate.ts`.
      `DryTypesCacheOption` trong `options.ts`.
- [x] Bước 7: Test thủ công qua dev server thật (đã restart để nhận code
      mới) - tạo fixture `page.tsx`/`layout.tsx`/`users/[slug]/page.tsx`,
      xác nhận: `dry()` global gọi được không cần import tay, nested layout
      bọc đúng, route động + params đúng, `dry()` query DB thật thành
      công (test với dữ liệu user thật), path lạ trả 404 thật, `/dry`
      admin không bị ảnh hưởng, xoá fixture xong live-reload tự nhận
      (có độ trễ nhỏ do file watcher, không phải bug). Đã xoá fixture sau
      khi verify xong.

Không verify được: `pages-cache`'s hành vi PRODUCTION thật qua dev server
(cache chỉ bật khi `!import.meta.env.DEV`, và Giai đoạn 3 - production
build - chưa tồn tại để có server production thật mà test). Đã verify đầy
đủ ở tầng unit test (5 case) thay thế - đủ tin cậy cho v1, sẽ có 1 lượt
verify qua server thật khi Giai đoạn 3 xong.

`bun run typecheck` xanh, `bun run test` 655/655 pass (66 file, tăng từ
639/62 trước khi bắt đầu).

## Tailwind v4 (phần của Giai đoạn 2) - xong

`@tailwindcss/vite` + `src/apps/globals.css` (1 file chung, đúng quyết
định đã chốt) + `<link>` trong `render.ts`'s head. Verify bằng cURL giả
lập header trình duyệt thật (`Sec-Fetch-Dest: style`) - Vite dev server trả
đúng CSS Tailwind thật (không phải JS wrapper), có đủ utility class 5
trang demo dùng.

**Sự cố dependency thật gặp phải**: gộp `@tailwindcss/vite` vào
`plugins: [...]` làm `tsc` báo "Excessive stack depth comparing types
'Plugin<any>[]'". Gốc rễ: `node_modules/.bun/` có sẵn nhiều bản `vite`
trùng version khác hash từ trước (không phải do cài tailwind) - 2 plugin
resolve type `vite` qua 2 instance khác nhau. Sửa bằng cách thêm
`"vite": "^8.0.13"` vào `package.json`'s `overrides` (đúng tiền lệ
`rollup` có sẵn) + xoá cache cũ + `bun install` lại - dedupe về 1 instance,
không cần workaround nào ở code.

5 trang demo (Giai đoạn 1 để lại) đã đổi từ inline `style=""` sang
Tailwind utility class, giữ trong repo làm ví dụ sống.

## Speed

Bắt đầu và hoàn tất Giai đoạn 1 trong 1 phiên (2026-08-05). Spike ở bước 1
lật ngược giả định ban đầu (`renderToReadableStream`) ngay từ đầu, tránh
phải viết lại `render.ts` giữa chừng - đúng lý do kế hoạch đặt spike làm
việc đầu tiên. Tailwind (phần của Giai đoạn 2) làm thêm cùng phiên, không
định trước.

Tiếp theo: client hydration (`preact-iso/hydrate`) - phần còn lại của
Giai đoạn 2 - khi được yêu cầu. Xem `plans/app-router.md`.

## Cập nhật 2026-08-05: gộp 2 Vite plugin thành 1

`dry-global-plugin.ts` (`transform`) và `hmr-plugin.ts` (`handleHotUpdate`)
gộp thành 1 file/1 plugin object: `app-router-plugin.ts`
(`appRouterPlugin()`) - cả 2 hook cùng phục vụ `src/apps/pages/**`, không
lý do kỹ thuật nào để tách riêng 2 entry trong `plugins: [...]`. Test gộp
theo: `app-router-plugin.test.ts` (7 case - 4 case `transform` cũ + 3 case
`handleHotUpdate` mới, trước đó chưa có test cho `handleHotUpdate`).
Cập nhật path ở mọi nơi tham chiếu tên file cũ (`vite.config.ts`,
`render.ts`'s comment, `codegen.ts`'s template cho `dry.generated.d.ts`).
`bun run typecheck` + `bun run test` xanh sau khi gộp.
