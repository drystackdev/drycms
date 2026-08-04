# App Router (`src/apps`) - thực thi Giai đoạn 1 + Tailwind (Giai đoạn 2) + Giai đoạn 3

## Plan

Xem `plans/app-router.md` cho toàn bộ kế hoạch (4 giai đoạn + 2 cơ chế
cache). File này track việc thực thi - Giai đoạn 1 (SSR streaming qua
adapter, file-based routing, `pages-cache`) đã xong đầy đủ; phần Tailwind
v4 của Giai đoạn 2 cũng đã xong (client hydration của Giai đoạn 2 thì
chưa); Giai đoạn 3 (production build, SSR-only - xem mục riêng bên dưới)
đã xong.

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

`pages-cache`'s hành vi PRODUCTION thật - đã verify qua server production
thật, xem mục "Giai đoạn 3" bên dưới (không còn treo).

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

## Giai đoạn 3 (Production build) - xong (2026-08-05)

Chi tiết thiết kế/lý do ở `plans/app-router.md`'s Giai đoạn 3 (đọc thẳng
source `vite` cài trong repo để xác nhận `--ssr <entry>` override
`rollupOptions.input`, và manifest key theo path nguồn chứ không theo alias
name - 2 điểm quyết định cách code chạy đúng). Tóm tắt file đổi:

- `vite.config.ts` - function-config form, `isSsrBuild`-gated thêm
  `src/apps/globals.css` làm entry thứ 2 + `manifest: true` cho build client.
- `src/server/app-router/assets.ts` (mới) - `resolveGlobalsCssHref(dev,
  manifestPath?)`, pure/testable (tham số hoá thay vì đọc thẳng
  `import.meta.env`/`process.cwd()` bên trong, cùng tinh thần
  `route-tree.ts`'s `buildRouteTree`). Test: `assets.test.ts` (3 case: dev
  path, prod đọc manifest thật, prod báo lỗi rõ khi thiếu entry).
- `render.ts` - `<link>` dùng `GLOBALS_CSS_HREF` thay vì hardcode path
  nguồn.
- `entry-node.ts` - nhánh mới `tryServeStaticAsset` (tách riêng khỏi shell
  fallback cũ) PHẢI chạy trước nhánh `handlePageRequest` - khác dev (Vite
  middleware tự lọc asset request trước khi tới App Router ở đó), prod
  không có lớp lọc đó nên phải tự kiểm tra file thật trước, nếu không
  request kiểu `/assets/main-abc123.js` sẽ bị route nhầm thành 404 (vỡ
  chính JS bundle của admin).

**Verify qua `bun run build && bun run start` thật (không chỉ đọc code)**:
- `bun run typecheck` xanh, `bun run test` 661/661 pass (67 file, tăng từ
  655/66 - thêm `assets.test.ts`).
- `bun run build`: xác nhận `dist/client/assets/appsGlobals-*.css` +
  `dist/client/.vite/manifest.json` sinh ra đúng (key `"src/apps/globals.css"`
  → `{ file: "assets/appsGlobals-....css" }`, đọc thử bằng `node -e`).
  `dist/server` sinh đúng 6 chunk riêng cho 2 `layout.tsx` + 4 `page.tsx`
  hiện có (root, `roles`, `users`, `users/[slug]`, 2 layout) - xác nhận
  `import.meta.glob` code-split đúng qua `vite build --ssr` mà KHÔNG cần
  script gom entry thủ công nào, đúng dự đoán trong plan.
- `node dist/server/entry-node.js` (port 3000) + `curl` thật:
  - `/`, `/users`, `/roles`, `/users/1` → 200, HTML render đúng, có `dry()`
    query DB thật (`/users/1` ra đúng "Khan Trần" / email thật; `/` ra đúng
    "1 user(s), 2 role(s)"), `<link>` trỏ đúng
    `/assets/appsGlobals-....css`.
  - `/assets/appsGlobals-....css` và 1 file JS admin thật
    (`/assets/main-....js`) → 200, không bị nhánh App Router nuốt mất.
  - `/dry` → vẫn admin SPA shell y nguyên, không đổi.
  - `/this-does-not-exist` → 404 thật (`Content-Type: text/plain`), không
    còn trang trắng.
  - `pages-cache` production: gọi `/users/1` 3 lần, đọc thẳng
    `.dry/pages-cache/users%2F1.json` giữa các lần gọi - `renderedAt`
    KHÔNG đổi giữa lần 2 và lần 3 (chỉ render 1 lần thật, các lần sau đọc
    cache) - xác nhận cache thật sự engage trong production, không phải
    trùng hợp HTML giống nhau do data không đổi. Đã xoá
    `.dry/pages-cache/` sau khi verify xong (không phải fixture cần giữ).

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

## Cập nhật 2026-08-05: Giai đoạn 3 (production build) xong

Chi tiết ở mục "Giai đoạn 3" phía trên. Còn lại: client hydration
(`preact-iso/hydrate`, phần chưa làm của Giai đoạn 2) - khi được yêu cầu,
xem `plans/app-router.md`.
