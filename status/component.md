# Component trong Page Editor

## Plan

`plans/component.md` - đầy đủ. Tóm tắt 4 quyết định đã chốt với user:

- Component lưu trong pages-source, KHÔNG có store riêng.
- Pages-source tách thành các "thư mục gốc": `pages/` (route) + `component/`
  (component), khai báo ở `src/server/app-router/source-roots.ts`, sau thêm
  root mới chỉ sửa file đó.
- Preview component chạy qua `buildPage()` thật, render trong iframe (CSS
  site + Tailwind thật), không render thẳng trong trang admin.
- Props preview sinh từ TYPE thật (TS worker của `Editer`), `defaultProps` đè
  lên (tên cũ: `_preview`, đổi 2026-08-11 - xem "Đợt sau").
- Component Builder cũ (`/dry/page-components` + store `.dry/components`) xoá
  hẳn, gộp vào Page Editor, dùng chung quyền Page Builder.

## Status

Xong: `bun run typecheck` sạch, `bun run test` 1137/1140 (3 fail còn lại có
sẵn từ trước, không liên quan - xem "Còn lại"), `bun run build` exit 0, và
QA thật trên trình duyệt đã chạy (mục "QA" bên dưới).

### Đã làm

- `src/server/app-router/source-roots.ts` (mới) - registry `PAGES_SOURCE_ROOTS`
  + `rootOf`/`resolveAliasSpecifier`. Không phụ thuộc gì (vite.config, web
  worker, server, client, script đều import được).
- Route discovery chỉ đọc root `pages`: `route-tree.ts` (nhánh dev lọc
  `pages/` + `buildRouteTree(modules, PAGES_ROOT)`), `route-manifest.ts`
  (`buildManifestRouteTree` cùng prefix, key vẫn là path đầy đủ nên
  `sourcePathOf` khớp `sourceByPath`). `component/page.tsx` không thành route.
- `scripts/sync-pages-r2.ts` map theo từng root: storage `pages/**` ↔
  `src/apps/pages/**`, `component/**` ↔ `src/apps/component/**` (KHÔNG mirror
  cả `src/apps` - trong đó có source thật `vei/`, `hydrate-client.ts`...).
  `.gitignore` thêm `/src/apps/component/`.
- `scripts/new-project.ts` tạo cả 2 root, starter site ghi vào `pages/`.
- Alias `@component/*` ở đủ 4 đường compile: `page-build.ts`
  (`resolveModulePath` + `IMPORT_FROM_RE` dựng từ registry để
  `transitiveDependencies`/`rewriteEsmImports` theo được), `vite.config.ts`
  (serve → `.dry/pages-source/component`, build → `src/apps/component`),
  `ts-worker.ts` (`resolveModuleName`), `tsconfig.json` (`paths`).
- Nhắc lệnh: `computeImportSpecifierCompletions` thêm nhánh alias, liệt kê
  `@component/<path>` từ chính `extraFiles` đang mở.
- Props schema: `ts-worker.ts`'s `describeDefaultExportProps` (đi từ default
  export → call signature → param đầu → duyệt property, giới hạn depth 4/30
  field/8 union option) → `PropsSchema` (JSON thuần, `worker-protocol.ts`) →
  `EditerResult.propsSchema`, chỉ bật khi `Editer` nhận `describeProps`.
  `props-sample.ts` (thuần, 14 test) biến schema thành SOURCE object literal
  (source chứ không phải JSON - còn phải sinh `() => {}`).
- `component-preview.ts` - entry ảo `__dry-preview-component.tsx` import
  component qua alias, `defaultProps` (object hoặc mảng nhiều biến thể) thắng
  props tự sinh, thiếu default export thì báo lỗi đọc được.
- `PageEditor.tsx`: 2 tab Page/Component (`[role=tablist]`, CSS
  `.page-editor-source-roots` - hạ 3rem xuống 2.25rem cho sidebar),
  `entriesForSourceRoot`/`withSourceRoot` (`tree.ts`) giữ NGUYÊN id path đầy
  đủ, chỉ re-parent con trực tiếp của root; tab suy theo file đang mở; file
  component mới có starter source dạy sẵn `interface Props` + `defaultProps`;
  preview/Build/Open-in-new-tab phân biệt component vs page; Save một
  component đánh dấu mọi page phụ thuộc là "chưa build"
  (`pagesAffectedBy`, mới trong `page-build.ts`, theo cả chuỗi layout).
- Xoá Component Builder cũ: `PageComponents.tsx`, `page-components/
  ComponentPreview.tsx`, `page-components/http-api.ts`, `sucrase-eval.ts`,
  `routes/page-components.ts` (+test), route trong `routers/App.tsx`, nav
  item + cờ `temporaryFeatureVisibility.pageComponents`, gate trong
  `handler.ts`, `PAGE_COMPONENTS_RESOURCE(_ID)`, `DryOption.pageComponents`
  (options/config/seed-assets/build-seed-assets + test tương ứng).
- Test mới: `props-sample.test.ts` (14), `component-preview.test.ts` (6),
  `tree.test.ts` +2 nhóm, `page-build.test.ts` + alias resolution/ESM rewrite
  + `pagesAffectedBy` (3). Test cũ cập nhật theo layout mới:
  `route-manifest.test.ts`, `page-handler.test.ts`, `options.test.ts`,
  `seed-assets.test.ts`, `vei-routes.test.ts`.
- Docs: `AGENTS.md` (mục hai page-source root), `docs/APP-ROUTER.md` (tiêu đề
  + phần mở đầu), `tsconfig.json` comment.

### QA (Playwright, dev server thật, tài khoản super admin thật)

Đã kiểm, tất cả đạt:

- Nav không còn "Page Components"; `/dry/page-editor` mở bình thường.
- 2 tab Page/Component; cây Page hiện `page.tsx` (KHÔNG hiện thư mục `pages`
  bọc ngoài), file đang mở là `pages/page.tsx`, preview trang `/` render đúng.
- Tạo `component/Card.tsx` từ tab Component → starter source có sẵn, preview
  render `_preview` (`Sample title`), toolbar KHÔNG có nút Build, "Open in a
  new tab" disable.
- Xoá `_preview`, khai báo props thật (`title/description/count/href/
  featured/tags/variant`) → preview tự sinh: `Title`, câu Lorem, `3` (count),
  `#` (href), `true` (featured - tên "positive"), `Tag, Tag, Tag`, `solid`
  (option đầu của union). Tailwind compile thật trong iframe: `p-4` → padding
  16px, `rounded` → radius 4px.
- Save → file nằm đúng `.dry/pages-source/component/Card.tsx`.
- Page `import Card from "@component/Card"` → preview trang render component
  với props của page (`7`, `false`, `a, b`, `ghost`, href `/blogs`).
- Type-check thật qua alias: `<Card title={123} />` báo `Type 'number' is not
  assignable to type 'string'` ở panel Problems (không im lặng thành `any`).
- Nhắc lệnh: gõ `import X from "@comp` → listbox có `@component/Card` đứng
  đầu (trước `preact`, `preact/hooks`, `preact/jsx-runtime`).
- Xoá component qua context menu + ConfirmDialog → mất khỏi store.
- Dev SSR (đường Vite, khác hẳn đường build trong browser): ghi thẳng 1
  component + page import nó vào `.dry/pages-source`, `curl http://localhost:5173/`
  trả về đúng markup của component → alias trong `vite.config.ts` chạy.
- `bun run pages:sync --pull` map đúng `pages/**` → `src/apps/pages/**`.
- CSS tab strip: cao 2.25rem (36px) cả 2 theme; light `rgb(28,37,46)` /
  muted `rgb(99,115,129)`, dark `#fff` / `rgb(145,158,171)` - chỉ khai báo
  kích thước, màu kế thừa nguyên `[role=tablist]` toàn cục. Console sạch
  (chỉ 1 INFO autofocus của trình duyệt).
- Dữ liệu QA đã dọn: `pages/page.tsx` khôi phục nguyên trạng (byte-for-byte
  từ bản backup), component test đã xoá.

**1 bug tìm được khi QA và đã sửa**: `ComponentTreePanel` suy chỗ tạo file
mới từ thư mục của file ĐANG CHỌN, nên khi mở tab Component trong lúc file
đang mở là `pages/...`, form tạo file render vào folder `pages` (tab này
không hiện) → bấm "New" trông như không có gì xảy ra. Sửa bằng
`selectedInActiveRoot`: chỉ truyền `selectedPath` xuống panel khi file đó
thuộc root của tab đang mở.

### Đợt sau (2026-08-11) - sân khấu preview + hợp đồng export mới

Theo yêu cầu user, 3 thay đổi nhỏ trên chính chỗ preview component:

- **Sân khấu preview**: `buildComponentPreviewSource` bọc mọi preview trong 1
  `<div>` `display:flex; justify-content:center; align-items:center;
  width:100dvw; height:100dvh; background-color:<màu theme hiện tại>`. Style
  inline thuần, KHÔNG class Tailwind - component có thể không dùng Tailwind,
  và đây là chrome do build chèn chứ không phải code tác giả viết.
  Màu nền lấy `--dry-background` đã resolve thành màu cụ thể qua
  `resolveThemeColor` mới (`lib/native/theme.ts`): đọc thẳng custom property
  ra `light-dark(...)` literal, đem sang iframe sẽ resolve theo
  `color-scheme` của TRANG BUILT chứ không phải của admin, nên phải sơn token
  lên element tạm rồi đọc `backgroundColor` ngược lại (bonus: ăn luôn màu
  người dùng đặt ở Settings → Theme). `PageEditor` theo dõi bằng
  `MutationObserver` trên class của root `.dry` chứ không subscribe signal
  `theme` - class mới là thứ token resolve theo, và `applyThemeTransition`
  lật nó BÊN TRONG callback view-transition, tức sau khi signal đã settle.
- **Hợp đồng export**: `_preview` → `defaultProps` (đổi tên, giữ nguyên
  ngữ nghĩa: object hoặc mảng nhiều biến thể). Thêm `export const _view =
  (<>…</>)`: JSX render sẵn, hiện nguyên xi, thắng cả `defaultProps` lẫn props
  tự sinh; check `_view` đứng TRƯỚC guard "thiếu default export" nên file
  preview qua `_view` không bắt buộc có default export.
- **Chiều cao khung**: component preview không còn dùng `PREVIEW_FRAME_HEIGHT
  = 900` cố định mà `previewViewportHeight / effectiveZoom` (frame bị CSS
  `zoom` thu nhỏ, nên muốn chiếm đúng H trên màn hình phải xin `H / zoom`) →
  `100dvh` của sân khấu = đúng vùng đang nhìn thấy, không phải cuộn.
  `previewViewportHeight` đo bằng `ResizeObserver` qua callback ref thứ 3 trên
  cùng host với `viewport.viewportRef`/`previewScroll.ref`.

QA thật (Playwright, dev server, iframe computed style):

| | dark | light |
|---|---|---|
| nền sân khấu | `rgb(20, 26, 33)` = `#141a21` | `rgb(249, 250, 251)` = `#f9fafb` |

flex/center/center cả 2 theme; đổi theme giữa chừng → preview tự build lại
với màu mới, không cần reload. Chiều cao: host 520px, zoom 0.5404, frame CSS
962.313px → trên màn hình đúng 520px, iframe không cuộn dọc. `_view` (file
tạm có cả `defaultProps` lẫn `_view`) render đúng phần `_view` (2 node, kể cả
`<Component title="From _view B"/>` tự gọi), `defaultProps` bị bỏ qua như
thiết kế; file tạm đã xoá. `component/button.tsx` trong store local đã đổi
`_preview` → `defaultProps`.

### Còn lại

- **Di trú dữ liệu**: store local đã ở đúng layout mới
  (`.dry/pages-source/pages/page.tsx`). Nếu R2 production còn page nằm thẳng
  ở gốc thì phải chuyển vào `pages/` trước khi deploy - route discovery
  không còn nhìn ra ngoài root.
- 3 test fail có sẵn từ trước, KHÔNG do đợt này:
  - `auth.test.ts` ×2 - user response giờ có `avatar`, test chưa cập nhật
    (đến từ đợt avatar, `src/content-types/seed.ts` đang sửa dở ở working
    tree bởi session khác).
  - `sitemap.test.ts` ×1 - case này đọc glob thật `src/apps/pages/**` và kỳ
    vọng `/about` + `/blogs` của site DEMO cũ; project hiện tại (sau
    `new:project`) chỉ có mỗi trang gốc. Sau `pages:sync --pull`, `<loc>/`
    đã xuất hiện đúng - tức là nhánh glob vẫn chạy, chỉ là test bám vào nội
    dung không còn tồn tại. Sửa nó là việc riêng, không thuộc plan này.

## Speed

Một session: nghiên cứu → chốt 4 quyết định với user → viết plan → tách root
(user yêu cầu giữa chừng) → implement → test → QA trình duyệt (tìm+sửa 1
bug) → build. Xong.
