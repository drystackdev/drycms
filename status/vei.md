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
