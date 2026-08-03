# Xây dựng page builder

- Hiện tại chỉ làm việc với DEV, sau này sẽ hoạt động được ở production.
- Mô hình biên tập: **hybrid** — Monaco chỉ cho sửa phần nội dung/props bên
  trong 1 khung layout+component cố định (giống cách RichText đăng ký
  component qua `src/**/dry.<name>.<ext>`, xem `docs/ARCHITECTURE.md` mục
  RichText), KHÔNG cho tự do `import` module ngoài hay viết layout/logic tuỳ
  ý. Cần định nghĩa trước danh sách "block" (component) được phép dùng trong
  trang, page chỉ là 1 chuỗi block + props cho mỗi block.
- Flow lưu: **draft rồi mới Apply/Build riêng**, theo đúng pattern
  Content-Type Builder đã có (`docs/content-type-staged-apply.md`) — không
  ghi thẳng vào source tree đang chạy mỗi lần bấm lưu.
- Quyền truy cập: **permission riêng theo role**, không phải Super-Admin-only
  (xem mục "Permission" bên dưới).

## Vấn đề đã phát hiện khi đối chiếu với codebase hiện tại (cần giải quyết trước khi code)

**Quyết định kiến trúc mới (chốt sau khi trao đổi thêm):** page-builder
KHÔNG ghi file vào cây `src/` đang chạy. Code chạy/preview ở browser, và
khi Apply/Build, output (HTML tĩnh + JS bundle để hydrate) được lưu vào một
**storage root riêng** qua đúng cơ chế `src/storage/` hiện có — giống hệt
cách Icon Management và RichText "confirmed component" đang làm, KHÔNG phải
một hệ thống mới:

- `DryComponentsOption` (`src/server/options.ts:81-91`) là ví dụ mẫu:
  `{ storage?: DryStorageOption }`, root mặc định `"richtext-components"`,
  "a root of its own, same shape as `storage`/`icons`, so it never mixes
  with user-uploaded media" — page-builder nên thêm 1 option mới cùng hình
  dạng, ví dụ `pageBuilder?: { storage?: DryStorageOption }`, root mặc định
  `"page-builder"`.
- Build JS bundle: tái dùng nguyên pattern
  `src/components/RichTextField/build-component-bundle.ts` —
  `buildComponentBundle(entryAbsPath)` nested `vite.build()` +
  `@preact/preset-vite`, `write: false`, minify `oxc`, Preact để
  `external`/rewrite thành `./preact.js` dùng chung
  (`buildSharedPreactBundle()`), chỉ chạy trong dev server
  (`import.meta.env.DEV`), **không có bước build production riêng** — "dev
  sinh ra gì thì cái đó lên site thật" giống hệt RichText component hôm nay.
- Build HTML: vì code chạy ở browser, HTML tĩnh được tạo bằng cách render
  thật trong browser (mount Preact như tab preview / như
  `EditableDemo`/`@babel/standalone` đang làm ở Showcase — xem memory
  `project_drycms_editable_field_showcases`), sau đó capture markup và gửi
  lên server để ghi vào storage root cùng với JS bundle.

Điều này giải quyết gọn cả 3 vấn đề nghiêm trọng đã nêu trước đây:

1. ~~Đụng thư mục `src/pages/`~~ — không còn liên quan, vì không ghi gì vào
   `src/` nữa. `src/pages/` tiếp tục là của riêng admin, không đổi.
2. ~~Cần dựng SSR/SSG pipeline mới~~ — không cần renderer phía server: HTML
   là bản chụp (snapshot) được render sẵn ở browser tại thời điểm Apply/
   Build, server chỉ lưu/serve file tĩnh (giống hệt việc serve 1 file ảnh từ
   `storage`). **Đánh đổi cần biết:** đây là mô hình SSG (build-time
   snapshot) chứ không phải SSR per-request — nội dung lấy từ content type
   khác thay đổi sau đó sẽ KHÔNG tự cập nhật trên trang public cho tới lần
   Apply/Build kế tiếp, trừ khi JS bundle sau khi hydrate tự fetch lại dữ
   liệu mới (cần quyết định có làm vậy không).
3. **Route public vẫn cần 1 chỗ "chen ngang" trước SPA admin**, nhưng đơn
   giản hơn nhiều: không phải renderer, mà chỉ là file lookup. Pipeline
   request của Node adapter: static asset → `${path}/api/**` → **tra route
   trong storage root `page-builder`, serve file `.html` tĩnh nếu có** → SPA
   admin fallback (giữ nguyên hành vi hiện tại nếu không khớp).
4. **RCE risk giảm mạnh nhưng chưa hết.** Server không còn `import()`/
   `ssrLoadModule` code người dùng viết (chỉ serve file tĩnh đã build) — an
   toàn hơn nhiều so với phương án ghi thẳng vào source tree. Rủi ro còn lại
   nằm ở chính bước `vite.build()` phía server khi Apply (biên dịch code
   người dùng) — vẫn cần dry-run/validate trước khi build thật, và vẫn giữ
   permission riêng (mục Permission) vì đây là nơi duy nhất thực thi
   `vite.build()` với input do người dùng cung cấp.
5. **Monaco chưa có trong `package.json`.** Cần thêm dependency mới
   (`monaco-editor` hoặc `@monaco-editor/react`), lazy-load theo route giống
   các trang khác đang làm (xem comment code-splitting ở đầu
   `src/routers/App.tsx`) — không để nó vào chunk chung.
6. **Permission cho "page" chưa có chỗ đứng trong model hiện tại.**
   `PERMISSION_ACTIONS` (`src/content-types/permissions.ts`) và
   `permissionActionsFor()` chỉ derive từ `ContentTypeDefinition` thật (theo
   `kind`). "Page" không phải content-type (không có bảng/row), nên cần MỞ
   RỘNG model: hoặc (a) thêm 1 nhóm "system permission" cố định không phụ
   thuộc content-type để `RoleEditor.tsx` hiển thị và cho gán, hoặc (b) định
   nghĩa page như 1 pseudo-resource id (`"page"`) dùng lại
   `permissionKeyFor("page", action)` nhưng phải tự thêm action phù hợp
   (`edit`, `publish`) vào `PERMISSION_ACTIONS` và tự liệt kê trong
   `RoleEditor` thay vì để nó tự derive. Route ghi/publish phải tự gọi
   `access.can("page", "edit"|"publish")` giống cách
   `routes/content-entries.ts` đang làm cho collection/singleton.
7. **Quy ước dynamic segment chưa chốt.** Đề xuất dùng `[slug]` (1 cấp) cho
   v1, để dành `[...slug]` (catch-all) cho sau nếu cần blog category lồng
   nhau — tránh làm router phức tạp ngay từ đầu.
8. **Hợp đồng props giữa layout ↔ page ↔ client hydrate chưa rõ.** Cần định
   nghĩa: `layout.tsx`/`page.tsx` export `default async function(props)`,
   trả JSX; server render lồng layout → page, kết quả prop trả về (dữ liệu
   fetch async) phải được serialize (vd script tag JSON) để client hydrate
   dùng lại đúng props đó — tránh mismatch giữa markup server render và cây
   Preact client hydrate.
9. **Sidebar trái không được dùng chung signal `.collapsed` với sidebar admin
   chính (DryLayout)**, trừ khi cố ý muốn thu gọn cả hai cùng lúc — nên dùng
   1 signal riêng cho cây trang trong `/page-builder`.

## Cơ trang quản lý router

```
/
/about
/contact
/blog
```
- có children `/[slug]` (v1 — xem mục 7 ở trên)

## Xây dựng dựa trên component Preact

- Mỗi page = 1 `layout` (lồng nhau theo đường dẫn) + 1 chuỗi block, mỗi block
  là 1 component Preact đã đăng ký sẵn (mục hybrid ở đầu file) + props.
- Author/preview chạy ở browser (mount Preact thật). Khi Apply/Build: server
  (1) `buildComponentBundle()`-style compile source block/layout thành JS
  bundle tĩnh, (2) nhận HTML đã render sẵn từ browser, ghi cả hai vào storage
  root `page-builder` (xem mục "Quyết định kiến trúc mới" ở trên) — không
  còn file `.tsx` nào nằm trong `src/`.

## Cấu trúc lưu trữ (storage root, không phải thư mục trong `src/`)

- Root mới `page-builder` (qua `src/storage/`, cùng cơ chế `storage`/
  `icons`/`components.storage` — xem `DryComponentsOption`,
  `src/server/options.ts:81-91`), mỗi route ghi ra ít nhất:
  + `{route}.html` — bản HTML tĩnh đã render sẵn ở browser lúc Apply.
  + `{route}.js` — bundle hydrate (compile qua `buildComponentBundle`-style
    nested `vite.build()`), import chung `preact.js`
    (`buildSharedPreactBundle()`) như RichText component đang làm.
  + metadata (layout nào, danh sách block + props) để lần sau mở lại trong
    Monaco còn sửa tiếp được, không chỉ có HTML/JS đã biên dịch.
- `layout` lồng nhau theo đường dẫn vẫn là khái niệm logic (metadata), không
  còn là file thật `layout.tsx` trong `src/` — layout cha/con được compile
  chung vào bundle của route con khi build.

## Flow lưu (draft → Apply/Build)

- Sửa trong Monaco chỉ lưu draft (vd localStorage, giống Content-Type
  Builder) — KHÔNG ghi file thật ngay.
- Có action "Apply and build" riêng: dry-run validate (biên dịch thử/kiểm
  tra kiểu) rồi mới ghi thật vào `src/site-pages/` và trigger build.
- Cần quyết định thêm: build lại toàn bộ site mỗi lần Apply, hay chỉ
  build/patch route vừa đổi (ảnh hưởng thời gian chờ khi Apply).

## Giao diện

- path: `/page-builder` — khi vào trang này tự động thu nhỏ sidebar admin
  chính (menu `.collapsed` của DryLayout), KHÔNG dùng chung signal collapse
  với cây trang bên trái của page-builder (mục 9).
- Bên trái: cây trang (route tree) dạng thu gọn được thành float button
  menu ở góc trên bên trái, dùng signal collapse riêng cho page-builder.
- Bên phải: vùng viết code chia theo tab, có 1 tab chạy trang web realtime
  (preview) — vì code vốn đã chạy ở browser (mục "Xây dựng dựa trên component
  Preact"), preview = mount Preact thật ngay trong tab đó, không cần mock
  riêng. Đây cũng chính là bước tạo ra bản HTML sẽ được gửi lên server khi
  Apply/Build, nên preview và output Apply luôn khớp nhau.
- Dùng Monaco (cần thêm dependency — mục 5), giới hạn theo mô hình hybrid:
  chỉ hiện/sửa được phần props/nội dung cho phép, không phải toàn bộ file
  `.tsx`.

## Permission

- Thêm action mới cho resource `"page"` (vd `edit`, `publish`) — xem mục 6.
- `RoleEditor.tsx` cần hiển thị nhóm quyền này riêng, không tự derive từ
  content-type như hiện tại.
- Route Apply/Build phải tự gọi `access.can("page", "edit"|"publish")`,
  tương tự cách `routes/content-entries.ts`/`routes/content-types.ts` đang
  enforce.

## Quyết định đã chốt (2026-08-03)

- **Block registry:** dùng chung quy ước `src/**/dry.<name>.<ext>` +
  `DryComponent(...)` của RichText — không tạo registry riêng. Cần thêm 1
  cách phân biệt block nào dùng được trong RichText, block nào dùng được
  trong page (props/ràng buộc layout có thể khác nhau), ví dụ 1 flag/kiểu
  đăng ký thứ hai trên cùng `DryComponent(...)`, hoặc 1 thư mục con quy ước
  riêng (`dry.page.<name>.<ext>`) — cần thiết kế cụ thể lúc code, nhưng
  registry nền tảng thì dùng chung.
- **Phạm vi build khi Apply:** chỉ build route vừa đổi + mọi route con đang
  dùng layout bị đổi (không build toàn site). Cần một bảng/map "route nào
  dùng layout nào" để tính đúng tập ảnh hưởng mỗi lần Apply — layout đổi ⇒
  rebuild toàn bộ route con của layout đó; page/block đổi ⇒ chỉ rebuild route
  đó.
- **Data freshness:** v1 dùng snapshot tĩnh thuần tuý — HTML là dữ liệu tại
  thời điểm Apply, không tự fetch lại sau hydrate. Nội dung động (vd danh
  sách blog) chỉ cập nhật khi có Apply mới. Fetch-lại-sau-hydrate (kiểu
  ISR/CSR) để dành cho version sau nếu cần.
- **Deploy production:** build chạy ngay trên production — admin đăng nhập
  `/page-builder` trên môi trường production thật, bấm Apply thì
  `vite.build()` chạy và ghi thẳng vào storage root `page-builder` của chính
  production đó, đúng như cách Icon Management/RichText component đang hoạt
  động hôm nay (không cần thêm bước CI/CD đồng bộ file).

## Việc còn mở, cần quyết định tiếp trước khi code

- Cách phân biệt "block dùng cho RichText" vs "block dùng cho page" trong
  cùng 1 registry `dry.<name>` (xem mục Block registry ở trên) — cần chốt
  quy ước cụ thể trước khi viết `register-component.ts`-tương-đương cho
  page.
- Cấu trúc dữ liệu "route → layout đang dùng" lưu ở đâu để tính phạm vi
  rebuild (mục Phạm vi build) — có thể là 1 phần metadata trong chính storage
  root `page-builder`, hay 1 index riêng.
