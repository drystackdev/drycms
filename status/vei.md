# Visual Editing Interface (VEI)

Kế hoạch đầy đủ + mọi quyết định: `plans/vei.md`. File này chỉ theo dõi tiến độ
thực thi.

## Plan

6 bước, mỗi bước verify được riêng (chi tiết trong `plans/vei.md`):

1. Lõi `dry-vei.ts` + auth (cookie `drycms_vei` Path=/, hint `drycms_admin`,
   route enter/exit, `editMode` ở `page-handler.ts`).
2. Lớp 2 - `$` refs trên mọi record + `dryBind` ambient global.
3. Overlay client (nút nổi, outline, mở iframe dialog).
4. `VeiBridge` + `?_vei=1` bare mode + live preview patch DOM.
5. Save (`dry:entry-save` + `VeiAgent` tuần tự nhiều entry).
6. Lớp 1 magic (box chuỗi trong `toRecord`, hook `options.vnode`,
   `resolveImageSrc` forward ref, `valueOf()` ở `entry-where.ts`).

## Status

**Bước 1 - XONG, verify thật.** File mới: `content-types/dry-vei.ts` (+test, 25
case), `server/vei-session.ts`, `server/vei-routes.ts` (+test, 7 case). Sửa:
`session.ts` (gom `readCookie` chung), `routes/auth.ts` (đặt/xoá 2 cookie
`Path=/`), `page-handler.ts` (`resolveVeiContext` + bỏ qua pages-cache 2 chiều
+ `no-store`), `dry-context.ts` (`DryVeiContext`), 3 entry point nối
`handleVeiRoute`.

Verify bằng dev server thật: login → `GET /dry/vei/enter?to=/blogs` trả 303 +
`Set-Cookie: drycms_vei=...; Path=/; HttpOnly; Max-Age=7200`; `GET /` kèm cookie
đó trả `cache-control: no-store`, không kèm thì không.

**Bước 2 - XONG, verify thật.** `$` gắn vào mọi record `dry()` trả ra (kể cả
row đã `populate` → trỏ đúng entry của chính nó, không phải entry của trang).
`dryBind` thành ambient global cho `src/apps/pages/**` qua
`app-router-plugin.ts`, khai báo trong `codegen.ts` → `dry.generated.d.ts`.

Verify: thêm `{...dryBind(post.$.title)}` vào `blogs/[slug]/page.tsx`, request
kèm cookie ra `<h1 data-dry="c:blog:38:title:text" ...>`, request ẩn danh ra
`<h1 class=...>` y như trước.

**Bước 3 - XONG, verify bằng Playwright thật.** File mới:
`content-types/dry-vei-ref.ts` (tách phần wire-format thuần, không import - để
overlay không kéo `field-registry` vào bundle trang public), `apps/vei/overlay.ts`,
`apps/vei/overlay-styles.ts`. Sửa: `render.ts` (script overlay + config script
`#dry-vei-config`), `assets.ts`/`resolve-asset-href.ts`/`asset-hrefs-plugin.ts`/
`generated-asset-hrefs.ts`/`vite.config.ts` (thêm asset `appsVeiOverlay`).

Verify 3 trạng thái: edit mode → overlay + dock "Đang sửa nội dung" + class
`dry-vei-editing` + outline `dashed rgba(0,167,111,.6)` + click ra iframe
`/dry/content/blog/3nWuyG?_vei=1&_field=title`; chỉ có cookie hint → nút "Sửa
nội dung", 0 marker; ẩn danh hoàn toàn → không có overlay.

**Bước 4 - XONG.** File mới `pages/vei/bridge.ts` (cầu CustomEvent ↔
postMessage, same-origin only). Sửa: `field-events.ts` (+`listenForFieldInput`),
`App.tsx` (component `Chrome` - `?_vei=1` + đang bị frame thì render route
không có `DryLayout`; nạp bridge), `overlay.ts` (+`applyPreview`/`valueAtPath`).
Verify: gõ trong iframe → `<h1>` trên trang đổi theo, iframe không có sidebar.

**Bước 5 - XONG.** `field-events.ts` thêm `dry:entry-save`/`dry:entry-saved`;
`ContentEntryEditor` nghe và chạy **đúng hàm save sẵn có** (không trích xuất,
không nhân bản), bỏ `route()` khi ở trong frame. Overlay có nút Lưu + iframe ẩn
`.agent` lần lượt mở từng entry có draft rồi phát lệnh save.
Verify: sửa title → preview → Lưu → reload thấy giá trị mới → sửa ngược lại về
nguyên trạng (DB dev được trả về đúng như trước).

**Bước 6 - XONG.** Magic chạy **không sửa một dòng page code**. File mới
`app-router/vei-marker-hook.ts` (+test 8 case). Sửa: `dry-vei.ts`
(`boxRecordStrings`, deep-walk), `dry-populate.ts`, `render.ts` (cài hook + bọc
`renderToStringAsync` trong `runWithDryContext`), `http-source.ts`
(`resolveImageSrc` forward ref), `entry-where.ts` (`unbox` trước khi bind SQL).

Verify trên trang thật (`/blogs/:slug`, ẩn danh 200 và **0 marker**; edit mode
có): `data-dry="c:blog:38:title:text"`, `data-dry-html="...:content:richtext"`,
`data-dry-href="c:menu:1:refs.0.href:text"` (**field sâu trong repeatable
component, nằm trên attribute**), `c:category:2:title:text` (row đã populate trỏ
đúng entry của chính nó), `s:siteSettings:1:...` (singleton). `where:
category.id` vẫn query đúng.

**Polish sau khi xong 6/6 bước (cùng ngày, theo yêu cầu tiếp theo):**

- **Bare mode thiếu scroll+padding+toast**: `Chrome`'s `?_vei=1` bỏ qua
  `DryLayout` cũng bỏ luôn `.main`'s OverlayScrollbars, `.content`'s padding,
  và `<Toaster />` (chưa từng mount trong iframe → toast lỗi save trước đây
  sẽ câm lặng). File mới `pages/vei/VeiFrame.tsx` khôi phục cả ba ở quy mô
  dialog (padding `1.25rem 1.5rem 1.5rem` thay vì `4rem` đáy của trang đầy
  đủ). CSS: `.vei-frame`/`.vei-frame-content` cạnh `.content` trong
  `components.css`. Verify: `[data-overlayscrollbars-viewport]` có mặt,
  `.toast-viewport` có mặt, padding tính toán đúng 20/24/24px.
- **Cancel chuyển vào trong iframe, cạnh Preview**: nút "Hủy" nổi ở panel
  ngoài (đè góc iframe) bị bỏ hẳn. `ContentEntryEditor.tsx`'s nút Cancel sẵn
  có (trước chỉ hiện với collection, điều hướng `route(backTo)`) giờ hiện cả
  với singleton khi `isVeiFrame()`, và gọi `closeVeiDialog()` (mới, export từ
  `bridge.ts`) thay vì điều hướng. Panel ngoài không còn header/title -
  đóng bằng: nút Cancel trong iframe, click nền, hoặc Escape.
- **Màu + animation khớp admin**: `--vei-*` không thể `inherit` `--dry-*`
  thật (site chỉ nạp Tailwind, không nạp `tokens.css`) → copy nguyên giá trị
  (`--dry-primary #00a76f`, `--dry-backdrop`/`--dry-shadow-lg` 2 lớp đúng
  công thức, `--dry-border` 20% đúng bằng thay vì 24% đoán trước đó).
  Animation `vei-panel-in`/`vei-backdrop-in` copy nguyên keyframe
  `dry-dialog-in`/`dry-dialog-backdrop-in` (opacity+scale / opacity, 120ms
  ease). Verify: `getComputedStyle` panel bg `rgb(255,255,255)`, nút Save
  `rgb(0,167,111)`, backdrop `rgba(145,158,171,0.8)`, `animationName` đúng 2
  tên trên.
- **Toàn bộ chữ trong overlay dịch sang tiếng Anh** ("Edit mode"/"Save"/
  "Exit"/"Saving"/"No changes to save"/...) để khớp admin (admin 100% tiếng
  Anh, chỉ nội dung site là tiếng Việt).
- **Loading effect**: spinner phủ iframe (`.panel-loading`, tự ẩn khi bridge
  báo `vei:ready`, timeout an toàn 15s) lúc mở dialog; spinner + "Saving"
  trên nút Save lúc `saveAll()` chạy.

Cạm bẫy gặp lại 2 lần khi viết CSS trong template literal: comment chứa
backtick (`` `:host` ``, `` `ContentEntryEditor.tsx` ``) đóng sớm chuỗi JS
bao ngoài, vỡ hẳn cú pháp cả file - sửa bằng cách bỏ backtick khỏi mọi
comment bên trong `OVERLAY_STYLES`/`MARKER_STYLES`.

## Speed

Xong 6/6 bước + polish. `bun run typecheck` xanh, `bun run test` 804 pass (78
file), `bun run build` xanh (asset `appsVeiOverlay`). Verify lại toàn bộ
vòng đời bằng Playwright thật sau polish: sửa → preview → Cancel trong
iframe đóng dialog → Save (spinner hiện) → reload thấy giá trị mới → khôi
phục nguyên trạng.

### Một lỗi CÓ SẴN phải sửa vì nó chặn dialog

`/dry/media` và mọi route `/dry/content/*` **đang hỏng trong dev** (main rỗng,
`Module "node:fs" has been externalized for browser compatibility`). Nguyên
nhân: `storage/http-source.ts:1` import `path` từ `server/config.ts` →
`server/options.ts` → `node:fs`. Không liên quan gì tới VEI (đã xác minh:
`/dry/media` hỏng y hệt, `/dry/content-types` thì không), nhưng dialog của VEI
mở đúng những route đó nên phải sửa.

Sửa: thêm `storage/admin-path.ts` (module **không import gì**) - trình duyệt lấy
`window.__DRY_CONFIG__.path`, server được `config.ts` đẩy vào bằng
`setAdminPath` lúc nó evaluate. `http-source.ts` gọi `adminPath()` thay vì
import config. Sau khi sửa: `/dry/media` 6 input, `/dry/content/blog` 10 input,
0 lỗi console.

### Phát hiện khác: id trong URL admin là id đã băm

Reader trả `record.id` = row id thật (38), nhưng admin định địa chỉ entry bằng
id obfuscate (`lib/id-hash.ts`, `3nWuyG`) - `/dry/content/blog/38` là 404.
`DryRef.id` vẫn giữ số thật (đúng với tầng dữ liệu); overlay gọi
`encodeEntryId()` khi dựng URL.

### Ba thay đổi so với `plans/vei.md` (đều do thực tế code ép)

1. **`X-Frame-Options: DENY` → `SAMEORIGIN`** (`adapters/node.ts:63`,
   `entry-worker.ts:39`). Kế hoạch không thấy chỗ này: `DENY` chặn iframe **kể
   cả same-origin**, tức chặn luôn dialog. API vẫn giữ `DENY` riêng
   (`handler.ts`'s `secureResponse`, header của Response thắng default của
   adapter).
2. **Cookie VEI mang token riêng, không copy token session.** Token session chỉ
   sống 15 phút và chỉ được gia hạn từ SPA admin (đang không mở khi duyệt trang
   public) → copy sang sẽ rơi khỏi edit mode giữa chừng. Thêm
   `SignSessionOptions.expiresInMs` (optional, mặc định không đổi) và mint token
   2 giờ. Cùng khoá ký, cùng `verifySessionClaims` + `isAuthSessionValid` nên
   logout vẫn giết được ngay.
3. **`$` gắn vô điều kiện, inert khi không ở edit mode** - kế hoạch định chỉ gắn
   khi có quyền. Sai: `dryBind(post.$.title)` là code trang chạy ở **mọi**
   request và cả lúc hydrate, nên thiếu `$` là ném `TypeError` cho từng khách
   vãng lai. Đã gặp thật (500 trên `/blogs/:slug` khi request ẩn danh) trước khi
   sửa. Client (`dry-reader-client.ts`) cũng gắn `$` inert vì trình duyệt không
   có schema để resolve path.

### Một lỗi suýt ship, chỉ unit test bắt được

Sau khi bật boxing, HTML **SSR ra rỗng** ở mọi chỗ đã đánh dấu
(`<h1 data-dry="...">​</h1>`): `preact-render-to-string` kiểm
`typeof child === "string"`, nên một `String` OBJECT bị render thành text
rỗng. Trình duyệt trông vẫn đúng vì hydration điền lại từ replay log (là chuỗi
thường) - tức kiểm tra bằng Playwright **không thấy gì bất thường**, chỉ
`curl` + unit test mới lộ. Sửa: hook `vei-marker-hook.ts` gỡ box ngay sau khi
ghi marker (children, attribute, và `__html`).

### Chưa làm: `e2e/vei.spec.ts`

E2E chạy trên DB fixture bị xoá sạch mỗi lần (`scripts/e2e-server.mjs`), nên
không có content type `blog`/`siteSettings` lẫn trang site nào để VEI bám vào.
Muốn có e2e thật thì phải thêm fixture: tạo content type + entry qua API **và**
thêm một route test cố định vào `src/apps/pages/**` - tức nhét một trang test
vào site thật của người dùng. Chưa làm vì đó là quyết định của người dùng, không
phải chi tiết kỹ thuật. Bù lại: toàn bộ vòng đời đã verify bằng script
Playwright chạy trên dev server thật (mở dialog → gõ → preview → Lưu → reload →
khôi phục), cộng 35 unit test mới cho phần marker/boxing/hook/route.

### Ghi chú để không quên

- Cookie VEI sống 2 giờ, nhưng **vào** edit mode lại cần session admin còn hạn
  (access token 15 phút). Hết hạn → `/dry/vei/enter` chuyển hướng sang
  `/dry/login`. Gặp thật lúc test. Chấp nhận được cho v1; muốn mượt hơn thì
  `enter` phải tự rotate bằng refresh cookie, mà việc đó cần cả
  `rotateAuthSession` + tra `user`/`role` như `routes/auth.ts` đang làm.
- `src/apps/pages/**` giờ **không có thay đổi nào** - `dryBind` tạm dùng để
  verify bước 2 đã gỡ, magic tự đánh dấu đúng chỗ đó.
- Marker chỉ gắn cho type mà người xem có quyền `update` (singleton:
  `setting`), lọc ngay lúc box - không phải lọc ở UI.

**Polish đợt 3 (cùng ngày, sau đợt polish đầu):**

- **Dock float bên trái giờ animate width khi nội dung đổi** (status text
  dài/ngắn, nút Save thêm/bớt spinner). CSS `transition: width` không tự chạy
  giữa hai giá trị `auto` → `overlay.ts` thêm `animateDockWidth()`: đo
  `getBoundingClientRect().width` hiện tại, khoá thành px, đổi nội dung, đợi 1
  frame (`requestAnimationFrame`, cùng kiểu với `Toast.tsx`'s `mounted` dance),
  rồi set `scrollWidth` mới - CSS transition lo phần nội suy. `setStatus()` +
  `setSaving()` đều đi qua đây.
- **`.page-header` (dùng chung bởi ~17 trang admin, không riêng VEI) giờ
  sticky top**, nền mờ blur giống hệt công thức `.topbar` sẵn có
  (`color-mix(... var(--dry-background) 80%, transparent)` + `blur(8px)`).
  **Cạm bẫy phát hiện trước khi ship**: `.page-header` và `.topbar` cùng nằm
  trong một vùng cuộn OverlayScrollbars (`.main`) - nếu cả hai đều `top:0` thì
  khi cùng dính, `.page-header` (render sau) sẽ đè lên `.topbar`. Sửa bằng
  `top: var(--dry-topbar-height)` mặc định, override `top: 0` riêng cho
  `.vei-frame-content .page-header` (nơi không có topbar). Verify đo
  `getBoundingClientRect().top` sau khi cuộn hết cỡ: trang admin dừng đúng
  `64px` (không đè topbar), trong VEI dừng đúng `0px`.
  **Cạm bẫy đo đạc**: `Playwright` `Locator.boundingBox()` trên một
  `frameLocator` trả toạ độ theo hệ quy chiếu của TRANG NGOÀI (vị trí iframe
  trên màn hình), không phải theo tài liệu bên trong iframe - lần đầu đo ra
  `28px` tưởng là bug, thật ra do đo sai chỗ; đo lại bằng
  `frameDoc.locator(...).evaluate(el => el.getBoundingClientRect())` (chạy
  ngay trong context của iframe) mới ra đúng `0px`. Không có bug CSS thật -
  chỉ là bài học đo đạc.
- **Cancel chuyển hẳn vào trong iframe, cạnh Preview** (thay vì nút nổi ngoài
  panel đè góc iframe) - xem đợt polish đầu ở trên, và **màu sắc/animation
  overlay khớp `tokens.css`/`dry-dialog-in` thật** (không phải đoán).
- **Toàn bộ chữ trong overlay là tiếng Anh** ("Edit mode"/"Save"/"Exit"/
  "Saving"/"No changes to save"/...) khớp admin (nội dung site là tiếng Việt,
  nhưng chrome VEI là công cụ admin).

Không có file mới ở đợt này, chỉ sửa `overlay.ts`, `overlay-styles.ts`,
`components.css` (`.page-header`, `.vei-frame-content .page-header`).
`bun run typecheck`/`test`/`build` xanh sau mỗi đợt.

**Polish đợt 4 (2026-08-06): nút "Preview all" trên dock ngoài.** Dock giờ có
3 nút (status, **Preview all**, Save, Exit) thay vì 2. File mới
`pages/vei/ChangesPreview.tsx` - route `${path}/vei/changes`, đọc TOÀN BỘ
draft đang chờ trong IndexedDB (`getAllEntryDraftRecords()`, không lọc theo
trang - khác `saveAll()`'s `pendingTargets()` vốn chỉ lấy entry có marker
trên trang hiện tại), với từng entry: tải giá trị gốc từ server
(`entriesApi.get`/`getSingleton`, hoặc `blankEntryValue` cho entry mới chưa
tạo), `diffEntryValue` để ra danh sách field đổi, lọc theo `canAccess` như
`ContentEntryEditor` vẫn làm. Mỗi entry có nút "Open" điều hướng
`route()` ngay trong iframe (giữ `?_vei=1`) sang editor thật - dùng lại
đúng route/`ContentEntryEditor`, không phải trang riêng.

Mở bằng `overlay.ts`'s `openFrame()` (tách ra từ `openDialog()` cũ - giờ
`openDialog` chỉ còn gọi `openFrame(editorUrl(...))`), trỏ URL sang
`${config.path}/vei/changes?_vei=1` - dùng lại đúng sheet/panel/spinner/
Escape/backdrop-close đã có, không thêm cơ chế dialog mới.

Verify bằng script Playwright thật (không phải Playwright MCP, gọi trực
tiếp `@playwright/test` qua `bun run <script>.mjs`) trên dev server thật:
login → vào edit mode ở `/blogs/:slug` → sửa field title → Cancel (không
Save) → click "Preview all" → iframe mở `/vei/changes?_vei=1` → giá trị vừa
sửa xuất hiện đúng trong diff → click "Open" trên entry đó → điều hướng
đúng `/content/blog/<id>?_vei=1` NGAY TRONG CÙNG iframe, input vẫn giữ giá
trị draft → Cancel đóng dialog. Không đụng DB thật (draft chỉ ở IndexedDB
trình duyệt, không bao giờ bấm Save) nên không cần khôi phục gì sau khi
test. `bun run typecheck`/`test` (804 pass)/`build` xanh.

**Polish đợt 5 (2026-08-06, cùng ngày): số lượng trên "Preview all" + nút
Reset cạnh Open.** Dock's nút "Preview all" giờ có `<span class="badge sm
secondary">` đếm **tổng số draft trong IndexedDB** (không diff từng entry -
`ChangesPreview.tsx` lọc còn ít hơn vì nó bỏ draft không thực sự đổi so với
server, nhưng diff cần 1 request/entry nên quá nặng để chạy lại mỗi lần gõ
phím; đếm thô là đủ, sai số hiếm - chỉ khi 1 type/entry bị xoá sau khi tạo
draft). `overlay.ts` thêm `refreshPreviewCount()` (đọc
`getAllEntryDraftRecords().length`, ẩn badge khi 0), gọi lúc: mount, sau khi
đóng dialog sửa field (`closeDialog`), và (debounce 400ms, dài hơn draft
write's 300ms) mỗi lần nhận `vei:input` qua `schedulePreviewCountRefresh()`.

`ChangesPreview.tsx` mỗi entry card thêm nút Reset (icon `EraserIcon`, cạnh
Open) - xoá hẳn draft của entry đó (`discardEntryDraft`), có `ConfirmDialog`
"Discard these changes?" trước khi thực thi (giống hệt `ContentEntryEditor`'s
"Reset all" - đây CHÍNH LÀ hành động đó, chỉ gọi được từ danh sách nhiều
entry thay vì entry đang mở). Sau khi discard, card biến mất khỏi danh sách
(state cục bộ), không cần tải lại trang.

**Giới hạn đã biết, không phải bug**: discard draft ở `/vei/changes` không
đẩy revert ngược lại DOM của trang public đang mở (không có kênh "un-preview"
- `applyPreview()` chỉ có chiều patch tới, không có chiều ngược). Trang public
vẫn hiện giá trị đã gõ cho tới khi F5 - đúng như hạn chế preview DOM-only đã
ghi ở bước 4/plans/vei.md, không phải lỗi mới.

Verify bằng script Playwright thật: sửa field → badge dock hiện "1" (cả lúc
dialog sửa field còn mở, cả sau khi Cancel) → mở "Preview all" → bấm Reset
trên card → Confirm "Discard" → card biến mất, trang trống hiện "No pending
changes" → đóng dialog → badge dock quay lại ẩn (0). Không có file mới, chỉ
sửa `overlay.ts` + `ChangesPreview.tsx`. `bun run typecheck`/`test` (804
pass)/`build` xanh.

**Polish đợt 6 (2026-08-06, cùng ngày): dialog tự đóng khi hết thay đổi.**
`handleReset` giờ tính danh sách còn lại NGAY trong `setChanges`'s updater
(không đọc `changes` từ closure ngoài, tránh giá trị cũ) - nếu rỗng thì gọi
`closeVeiDialog()` luôn, không chờ người dùng bấm Close để thấy "No pending
changes" trước. Giống hệt lý do `ContentEntryEditor.tsx`'s
`handleResetField`/`handleResetAll` đóng `EntryPreviewDialog` khi hết diff.
`closeVeiDialog()` là no-op ngoài VEI frame nên gọi vô điều kiện, không cần
`isVeiFrame()` guard riêng ở đây. Verify Playwright thật: discard draft duy
nhất còn lại → Confirm → sheet tự biến mất khỏi shadow root, không cần click
Close. Chỉ sửa `ChangesPreview.tsx`. `bun run typecheck`/`test` (804
pass)/`build` xanh.

**Polish đợt 7 (2026-08-06, cùng ngày): ẩn nút back ở header trong VEI.**
`ContentEntryEditor.tsx`'s nút back (`ArrowLeftIcon`, góc trái `.page-header`,
chỉ hiện với collection) giờ thêm điều kiện `!veiFrame` - cùng lý do Cancel
đã đổi ý nghĩa trong VEI (không có list để "back" tới, xem polish đầu). Nút
Cancel bên phải header vẫn còn, vẫn là cách đóng dialog. Verify Playwright
thật: admin bình thường còn back button (1), trong VEI dialog ẩn (0), Cancel
vẫn có mặt (1). Chỉ sửa `ContentEntryEditor.tsx`. `bun run typecheck`/`test`
(804 pass)/`build` xanh.

**Polish đợt 8 (2026-08-06, cùng ngày): reveal xuyên vào item trong
`component-repeat`, + dock dùng thẳng `tokens.css` thay vì copy màu.**

Trước đây `?_path=` (deep link `_field`+`_path` từ click marker của một field
nằm trong `component-repeat`, ví dụ `pressMentions.0.outlet`) được `overlay.ts`
gửi đi nhưng KHÔNG bên nào đọc - `scrollToField` chỉ biết `?_field=` (top-level),
nên click vào một item bên trong dialog riêng của `ComponentField.tsx` chỉ
highlight cái field wrapper ngoài cùng, dialog của item đó (đóng theo mặc định,
chỉ mount fields khi `open`) không tự mở - đúng y hệt yêu cầu ban đầu: "hight
luôn item trong component" + "item trong dialog thì bật dialog lên luôn".

Sửa bằng cách thread `revealPath` (mảng segment của `_path`, fallback
`_field`) xuyên `ContentEntryEditor.tsx` → `FieldRenderer.tsx` (`flatten` tự
đệ quy, `component-repeat` tách `[index, tên field trong item]`) →
`ComponentField.tsx`'s 2 prop mới `revealIndex`/`revealField`: `revealIndex`
tự gọi `openEdit()` (mở đúng dialog của item đó - cách DUY NHẤT field bên
trong tồn tại trên DOM, vì `renderItem` chỉ mount khi `open`), `revealField`
sau đó tìm-và-flash field đó bên trong `.component-item-dialog-body` (scope
theo `bodyScroll.current`, không phải `document` - tránh trùng tên với field
top-level khác). File mới `components/fields/field-anchor.ts` (tách
`FIELD_ANCHOR_ATTR`+hàm flash ra khỏi `content-entry-editor/field-events.ts`,
vì `ComponentField.tsx` là component dùng chung (`Showcase.tsx` cũng dùng),
không được import ngược vào `pages/`). Giới hạn đã biết (ghi thẳng trong code):
reveal chỉ sâu tới field TOP-LEVEL của item, không sâu hơn - cùng độ sâu
`applyFieldSet`'s comment đã chấp nhận cho `dry:field-input`.

Verify Playwright thật (`@playwright/test` gọi trực tiếp qua script `.mjs`,
không phải MCP): click marker `pressMentions.0.outlet` trên trang chủ → dialog
`Edit Press Mentions` tự mở (trước đó luôn đóng) → field `outlet` bên trong
VÀ field `pressMentions` top-level đều flash `.entry-field-highlight` cùng
lúc, tự tắt sau ~1.5s. `bun run typecheck`/`test` (804 pass)/`build` xanh.

**Cùng đợt: dock/nút VEI đổi từ copy màu tay sang dùng thẳng `styles/tokens.css`.**
`overlay-styles.ts`'s `:host { --vei-primary: #00a76f; ... }` (bản copy tay
của palette thật, ghi từ polish đợt 1 - xem trên) có nguy cơ lệch dần với
`tokens.css` (đã lệch 1 lần, "24% đoán trước đó" chính là polish đợt 1 tự sửa).
Giờ `import tokensCss from "../../styles/tokens.css?raw"` (cùng cách
`dry.carousel.tsx`/`Editer.tsx` đã dùng cho CSS bên thứ 3) nhúng NGUYÊN VĂN
file thật vào đầu `OVERLAY_STYLES`, mọi rule còn lại đổi từ `var(--vei-*)`
sang thẳng `var(--dry-*)` (`--vei-shadow` bỏ hẳn, dùng `var(--dry-shadow-lg)`
có sẵn - công thức giống hệt). `overlay.ts` thêm 1 div `class="dry"` (biến
`scope`) bọc toàn bộ nội dung shadow root thay vì append thẳng vào `root` -
đây là phần tử DUY NHẤT bên trong shadow tree mang class mà rule thật của
`tokens.css` (`.dry {...}`) cần để match; không sửa selector nào trong
`tokensCss` (nhúng verbatim, 0 transform) nên ăn theo mọi thay đổi tương lai
của `tokens.css` tự động, không cần đồng bộ tay nữa. Badge đếm draft trên nút
"Preview all" (`className: "badge sm secondary"`, polish đợt 5 ở trên) trước
đó CHƯA có rule CSS nào trong `overlay-styles.ts` (chỉ tồn tại trong
`components.css`, shadow root không nạp) - tiện thể thêm `.badge`/`.badge.sm`/
`.badge.secondary` mirror đúng `components.css`.

Cạm bẫy gặp lại lần 3 (đã ghi ở polish đầu, lần 2 ở top): backtick trong
comment CSS bên trong template literal `OVERLAY_STYLES` vỡ cú pháp JS - sửa
bằng bỏ backtick khỏi mọi comment viết mới.

Verify Playwright thật, `page.emulateMedia`/`newContext({ colorScheme })`
light+dark: `getComputedStyle` dock/Save/Exit/label/badge khớp CHÍNH XÁC giá
trị tính từ `tokens.css` thật ở cả 2 theme (không còn số copy tay), kể cả
`--dry-shadow-channel`'s dark-mode switch (`0 0 0` thay vì `145 158 171`) qua
đúng `@media (prefers-color-scheme: dark)` rule thật của `tokens.css`, không
phải block riêng VEI tự viết (đã xoá). `bun run typecheck`/`test` (804
pass)/`build` xanh - bundle `appsVeiOverlay` tăng ~11.7kB → ~18.6kB (gzip
4.78kB → 6.52kB) vì nhúng nguyên `tokens.css`, chấp nhận được để đổi lấy
không bao giờ lệch màu nữa.

**Polish đợt 7 (2026-08-06, cùng ngày): spinner khi enter/exit, ẩn hẳn nút
"Preview all" khi rỗng, highlight field bằng div nổi thay outline, fix bug
dock không co lại.**

- **Spinner ngay khi click Edit content/Exit**: `/vei/enter`/`/vei/exit` là
  navigation thật (`window.location.href`), không tránh được reload (xem
  giải thích đã đưa cho người dùng - cookie cần round-trip `Set-Cookie`
  thật, marker chỉ tồn tại trong 1 lần render mới từ server). Thêm
  `navigateWithSpinner()` trong `overlay.ts`: disable nút + đổi thành
  spinner+text ("Opening editor"/"Exiting") NGAY trong click handler, trước
  khi set `location.href` - cho người dùng thấy phản hồi tức thì trong lúc
  chờ network round-trip, đỡ cảm giác nút bị "nháy"/giật. Verify Playwright:
  đọc state nút NGAY trong cùng 1 `evaluate()` vừa dispatch `click()` (tránh
  race với unload), cả 2 nút Edit content và Exit đều disabled+spinner đúng.

- **Ẩn hẳn nút "Preview all" khi không có draft nào** (trước chỉ ẩn badge số,
  nút vẫn còn). `refreshPreviewCount()` giờ set
  `previewButton.style.display = "none"` khi `records.length === 0`.

- **Highlight field khi hover trong VEI đổi từ CSS outline sang 1 div nổi
  riêng** (`.field-highlight`, `position: fixed`, `pointer-events: none`,
  z-index bằng `.dock`) - theo yêu cầu: outline vẽ trực tiếp trên field bị
  ăn theo stacking context/clipping của field đó, nên field nằm trong
  `overflow: hidden` hoặc bị component khác đè z-index cao hơn thì outline
  bị cắt/che. Div highlight là con của `scope` (chính shadow host đã gắn
  thẳng vào `<body>`, ngang hàng `.dock`) nên không bị 2 vấn đề đó.
  `overlay.ts` track bằng `mousemove` (capture) + `markedElementFor()` có
  sẵn, định vị qua `getBoundingClientRect()`, đồng bộ lại khi `scroll`
  (capture, bắt được cả scroll trong container lồng nhau) hoặc `resize`.
  Baseline dashed outline (mọi field có thể sửa, không chỉ field đang hover)
  vẫn giữ nguyên trong `MARKER_STYLES` - chỉ bỏ riêng rule `:hover` cũ (nay
  do div JS đảm nhiệm). `hideHighlight()` gọi thêm lúc `openFrame()` mở
  dialog (phòng hờ, dù backdrop `.sheet` đã che kín rồi). Verify Playwright:
  hover đúng field ra div `position: fixed` khớp toạ độ
  `getBoundingClientRect()` của field (sai số ≤2px), rời chuột ra thì ẩn.

- **Bug tự phát hiện lúc verify polish trên: dock không co lại khi ẩn nút**.
  `animateDockWidth()` cũ đo "after" bằng `dock.scrollWidth` ngay sau khi
  `dock.style.width` còn đang bị khoá cứng ở giá trị `before` - `scrollWidth`
  chỉ báo được phần con NHÔ RA ngoài box hiện tại (đúng khi nội dung tăng),
  không báo được khi nội dung GIẢM (ẩn hẳn "Preview all") vì box vẫn còn đủ
  rộng để chứa, không có gì "overflow" để đo. Sửa: nhả `dock.style.width =
  "auto"` để đo kích thước tự nhiên thật bằng `getBoundingClientRect().width`
  (đúng cả 2 chiều tăng/giảm), rồi khoá lại `before`px trước khi chạy
  animation sang giá trị đo được. Verify Playwright: dock 221px (0 draft) →
  353px (1 draft, "Preview all" hiện) → về đúng lại 221px (reset draft) -
  không còn kẹt ở 345px như trước khi sửa.

Không có file mới, chỉ sửa `overlay.ts` + `overlay-styles.ts`. `bun run
typecheck`/`test` (804 pass)/`build` xanh.

### Bổ sung: permission `system-vei` (2026-08-07)

Trước bản này VEI không có gate quyền nào - bất kỳ admin đăng nhập nào cũng
vào được edit mode (quyền `update`/`setting` theo từng content type vẫn giới
hạn SỬA được gì qua `resolveVeiContext.canUpdate`, nhưng không giới hạn ai
được MỞ overlay). Đã thêm resource System thứ 7, gate thật ở
`vei-routes.ts`'s `handleVeiRoute` (403 nếu role không có
`system-vei:setting`, trước khi set cookie `drycms_vei`) + đồng bộ cookie
hint `drycms_admin` (`routes/auth.ts`) theo đúng quyền đó. Chi tiết đầy đủ ở
`status/role-system-permissions.md`'s addendum cùng ngày. `bun run
typecheck` sạch, `bun run test` 88 file/935 test pass (2 test mới), `bun run
build` xanh.

### Bổ sung: panel mode giữ overlay sống, click field khác đổi URL panel (2026-08-07)

Yêu cầu: khi bật panel mode (side panel bên phải), trang public vẫn phải
hiện overlay để click vào field khác được, và panel đổi URL theo field vừa
click.

Trước bản này panel mode chỉ *nhìn* như non-modal: CSS đã cho click xuyên
qua (`.sheet.docked { pointer-events: none }`), page đã bị đẩy bằng
`margin-right`, scroll không bị khoá - nhưng 2 chỗ JS trong `overlay.ts` vẫn
chặn cứng bằng `if (sheet.isConnected) return`:

- listener `mousemove` → không còn hover highlight khi panel mở
- `intercept` (mousedown/click capture) → click vào field không mở editor
  nữa, mà còn tệ hơn: link/button thật của trang chạy default action, tức là
  điều hướng đi mất trong lúc panel đang mở dở.

Sửa: thêm `isModalSheetOpen()` = `sheet.isConnected && !isDesktopPanel()` và
dùng nó cho cả 2 chỗ trên - chỉ dialog mode và drawer mobile mới là modal
thật. `openFrame()` sửa thêm 3 điểm để chịu được việc bị gọi lại lúc panel
ĐANG mở:

- cùng URL → return sớm (không reload iframe, tránh mất draft đang gõ dở vì
  `saveEntryDraft` debounce 300ms)
- `scope.append(sheet)` chỉ chạy khi chưa mở (append lại node cũ =
  remove+insert, sẽ chạy lại animation `vei-panel-dock-in` mỗi lần click
  field)
- `hideHighlight()` + `lockBodyScroll()` chuyển vào nhánh `!isDesktopPanel()`
  - side panel giữ luôn highlight để thấy field nào đang được sửa.

Verify Playwright (script tạm, không thêm vào `e2e/`), viewport 1440x900,
trang chủ dev server thật:

- panel mode: click field 1 → `.sheet.docked`, `marginRight: 480px`,
  `pointer-events: none`, src = `/dry/content/siteSettings?_vei=1&_field=brandName`
- hover field khác lúc panel đang mở → `.field-highlight` display `block`
- click field khác → src đổi sang
  `/dry/content/menu/2mBGhT?_vei=1&_field=refs&_path=refs.0.href`, sheet
  không bị đóng/mở lại, `location.href` vẫn ở `/` (link `<a>` không điều
  hướng đi)
- click lại đúng field đó → src giữ nguyên, `.panel` không vào lại trạng
  thái `loading`
- regression dialog mode: `htmlOverflow: hidden`, không push page, highlight
  `none`, click field khác KHÔNG đổi src, Escape đóng + trả lại overflow
- regression mobile (420px, panel mode): vẫn `docked` nhưng modal
  (`htmlOverflow: hidden`, không push page)

Chỉ sửa `src/apps/vei/overlay.ts`. `bun run typecheck` sạch (lỗi
`blogs/page.tsx:78` là có sẵn từ trước, không liên quan). `bun run test`:
16 fail có sẵn ở `seed/sqlite/dry-reader/entries-sqlite` - do live DB đã
lệch seed (xem `status/`-note về seed vs live DB), không file nào trong đó
import `overlay.ts`.

### Bổ sung: overlay chrome (dock/backdrop/panel) không theo theme admin đã ghim (2026-08-07)

Bug: `--dry-*` token đã inline đúng qua `tokensCss` từ lâu, nhưng khi admin
CHỌN HẲN light/dark (không phải "system") ở `ThemeToggle`, overlay's `.dry`
scope không nhận `light`/`dark` class - chỉ `light-dark()` fallback theo OS.
Trong khi entry editor mở trong `frame`/`agent` là 1 trang `/dry` thật, được
`index.html`'s inline script + `lib/native/theme.ts` gắn class đúng - nên
dock/backdrop/panel của overlay lệch theme so với chính editor nó đang mở.

Sửa: thêm `currentTheme()`/`applyOverlayTheme()` trong `overlay.ts`, đọc
cùng key `drycms:store` (không import `lib/native/theme.ts` - module đó gắn
thêm global `[data-theme-toggle]` click listener, việc của trang admin,
không phải file public-site này). Gọi 1 lần lúc tạo `scope`, và lắng thêm
`storage` event trên `window` để đồng bộ SỐNG khi ThemeToggle chạy bên trong
iframe đổi theme lúc panel/dialog đang mở (`storage` không tự bắn ở chính
document vừa ghi, chỉ bắn ở các document cùng origin KHÁC - iframe là 1
window khác nên đúng cơ chế này).

Verify Playwright: ghim `theme: "dark"` trước khi tải trang → `scope`
classList có `dark`, `.dock` background = `rgb(28, 37, 46)` (đúng
`--dry-popover` dark). Bắn `storage` event đổi sang `light` → classList cập
nhật sống thành `light`, không cần reload.

Chỉ sửa `src/apps/vei/overlay.ts`. `bun run typecheck` sạch (lỗi
`blogs/page.tsx:78` có sẵn từ trước).

### Bổ sung: field-highlight bị lệch lúc panel slide-in (2026-08-07)

Bug: bản panel-mode ở trên cố tình GIỮ `.field-highlight` khi mở side panel
(để thấy field nào đang sửa), nhưng `syncDockedLayout`/`setPagePush` đẩy
`<html>` bằng `margin-right` có animate (160ms) - làm cả trang reflow, field
vừa click dịch chuyển ra khỏi vị trí `.field-highlight` đã đo TRƯỚC lúc đẩy.
Kết quả: khung highlight bị "lệch" khỏi field trong lúc slide chạy.

Sửa: `hideHighlight()` gọi VÔ ĐIỀU KIỆN ngay đầu `openFrame()`, trước cả
`syncDockedLayout` - không còn chờ tới nhánh `!isDesktopPanel()` nữa. Ẩn
ngay tại thời điểm click, không cố re-measure giữa lúc transition đang chạy.
`mousemove` thật tiếp theo (di chuột) sẽ tự re-mark + định vị lại đúng theo
layout đã ổn định - cùng cách file này đã xử lý case `scroll` (comment cũ:
"the next mousemove... re-marks whatever ends up under the pointer").

Verify Playwright (panel mode, viewport 1440x900): hover field → highlight
`block`; click → NGAY LẬP TỨC (trước khi đợi animation) → `none`; giữ `none`
sau 1.5s không di chuột; di chuột sang field khác sau khi trang đã ổn định →
`block` lại, toạ độ khớp `getBoundingClientRect()` của field đó (đúng, do đo
SAU push chứ không phải trước).

Chỉ sửa `src/apps/vei/overlay.ts`. `bun run typecheck` sạch (lỗi
`blogs/page.tsx:78` có sẵn từ trước).

### Bổ sung: nút Magic chat lệch trái trong VEI + mode-toggle vẫn hiện lúc panel mở (2026-08-07)

**Magic chat sang trái trong VEI**: `components.css`'s `.magic-chat-widget.vei`
(2 chỗ - desktop `&.vei`, mobile `@media (width<48rem) &.vei`) tự lật bong
bóng sang `inset-inline-start` (trái) bên trong iframe dialog VEI, "mirror"
theo `VeiFrame.tsx`'s `<Toaster position="bottom-start" />`. Lý do gốc (comment
cũ) không còn khớp thiết kế hiện tại - kết quả nhìn thấy được: nút Magic nằm
bên TRÁI trong VEI thay vì bên phải như trang admin bình thường. Xoá cả 2
block `&.vei` (desktop+mobile) - bong bóng giờ luôn `bottom-end` (phải) bất
kể trong VEI hay không, khớp yêu cầu "giống admin". Toast vẫn giữ nguyên
`bottom-start` trong VEI (đủ tránh va chạm vì giờ 2 bên đối diện nhau, không
cần shift nữa) - gộp 2 rule `:has()` cũ (1 cho non-vei, 1 cho vei) thành 1
rule chung, xoá rule dành riêng cho `.toast-viewport.start` (không còn cần
shift khi bong bóng không còn ở cùng phía). `veiFrame`/class `vei` trong
`MagicChat.tsx` giữ nguyên (không xoá) - vô hại, có thể cần lại sau.

**`.mode-toggle` (dialog/panel switch) vẫn hiện dù sheet đang mở**: đổi mode
lúc sheet ĐÃ mở không có tác dụng gì thấy được - `openFrame()` chỉ áp
`mode` vào `.sheet`'s class `docked` lúc MỞ (nhánh `!alreadyOpen`), không áp
lại cho sheet đang mở sẵn - nên bấm nút chỉ im lặng không làm gì, gây khó
hiểu. Thêm `EditingDockHandle.setSheetOpen(open)` (`Dock.tsx`) + state
`sheetOpen`, `ModeToggle` chỉ render khi `!sheetOpen` (ẩn hẳn, không disable -
disable vẫn mời bấm vào thứ không làm gì). `overlay.ts` gọi
`dock.setSheetOpen(true)` đầu `openFrame()`, `dock.setSheetOpen(false)` đầu
`closeDialog()`.

Verify Playwright (panel mode, viewport 1440x900): `.mode-toggle` có mặt
trước khi mở field nào; mất hẳn ngay khi panel mở (`sheetConnected: true`);
Escape đóng panel → `.mode-toggle` xuất hiện lại, `sheetConnected: false`.

Sửa `components.css`, `Dock.tsx`, `overlay.ts`. `bun run typecheck` sạch
(lỗi `blogs/page.tsx:78` có sẵn từ trước). `bun run test`: vẫn 958 pass/16
fail như trước 2 bản sửa VEI gần nhất (fail có sẵn, không liên quan file
này).

### Bổ sung: focus field trong panel VEI → tự scroll + đổi border solid trên trang (2026-08-07)

Tính năng mới, chưa từng có: focus 1 field trong form của panel/dialog VEI
giờ tự scroll trang public đến field tương ứng (nếu field đó CÓ marker trên
trang hiện tại) và đổi outline dashed baseline (`MARKER_STYLES`) sang solid
cho riêng field đang focus.

Cơ chế - 3 chặng, đi đúng đường dây `field-events.ts` đã có sẵn cho
`dry:field-input`/`dry:field-set` (module tự nhận là điểm nối cho "AI
feature, browser extension, plugin ngoài bundle"):

1. **`ContentEntryEditor.tsx`** (chạy trong iframe): 1 cặp listener
   `focusin`/`focusout` mức `document` (bubble, không cần gắn từng field) -
   `focusin` tìm `[data-field-name]` gần nhất từ `event.target`, cắt về top-
   level (`split(".")[0]`, cùng cách `applyFieldSet` đã cắt cho path lồng
   component), dispatch `dry:field-focus` (`field-events.ts`, mới thêm) kèm
   `typeSlug`/`entryId` hiện tại. `focusout` chỉ dispatch `null` khi
   `relatedTarget` (phần tử SẮP nhận focus) không nằm trong field nào - tab
   giữa 2 control CÙNG field không bắn `null` giữa chừng.
2. **`bridge.ts`**: relay `dry:field-focus` → `postMessage({ type:
   "vei:focus", detail })` ra ngoài, y hệt cách `vei:input` đã relay
   `dry:field-input`.
3. **`overlay.ts`**: `elementsForFocus(name, typeSlug, entryId)` - match y
   hệt logic per-marker của `applyPreview` (so `ref.type`/`encodeEntryId`/
   segment đầu của `ref.path`), không ghi giá trị, chỉ trả về element.
   `applyFieldFocus()` xoá class cũ (`clearFieldFocus`), nếu `name` không
   null thì gán class `dry-vei-focused` cho mọi marker khớp +
   `scrollIntoView({behavior:"smooth", block:"center"})` phần tử đầu tiên.
   Gọi từ nhánh `vei:focus` mới trong message listener của dialog/panel
   iframe; `clearFieldFocus()` cũng gọi trong `closeDialog()` để không để
   sót outline solid sau khi đóng.

Granularity CHỈ ở cấp top-level field (giống toàn bộ hệ thống marker hiện
tại) - focus vào 1 sub-field bên trong 1 component/group (`hero.headline`)
sẽ sáng SOLID hết mọi marker thuộc `hero.*` trên trang, không riêng
`headline` - đúng cách `dry:field-input`/`applyPreview` đã hoạt động cho
input/preview, không phải giới hạn riêng của tính năng này.

CSS: `MARKER_STYLES` thêm rule `html.dry-vei-editing .dry-vei-focused {
outline-style: solid; }` - cùng độ đặc hiệu với rule baseline, thắng nhờ thứ
tự khai báo sau.

Verify Playwright (panel mode, 1440x1200, trang chủ dev server thật): click
field "hero" (H1) mở panel trỏ `/dry/content/homepage?...&_field=hero`,
focus input đầu tiên trong panel → 5 marker thuộc `hero.*` trên trang (span
eyebrow, h1, 2 p, img) đều `outlineStyle: solid`; click ra ngoài field (h1
trong iframe, không có `data-field-name`) → về 0 phần tử `.dry-vei-focused`.

Sửa `field-events.ts` (thêm `FIELD_FOCUS_EVENT`/dispatch/listen),
`ContentEntryEditor.tsx` (effect focusin/focusout), `bridge.ts` (relay
`vei:focus`), `overlay.ts` (`elementsForFocus`/`applyFieldFocus`/wiring),
`overlay-styles.ts` (`.dry-vei-focused`). `bun run typecheck` sạch (lỗi
`blogs/page.tsx:78` có sẵn từ trước). `bun run test`: vẫn 958 pass/16 fail
như các bản sửa VEI trước (fail có sẵn, không liên quan các file này).
