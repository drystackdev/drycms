# Visual Editing Interface (VEI)

Sửa field ngay trên trang public (`src/apps/pages/**`), không phải vào `/dry`
tìm entry. Kế hoạch này đủ chi tiết để làm một lượt, mọi quyết định đã chốt.

## Khả thi - phần khó nhất đã có sẵn

- `toRecord()` (`src/content-types/dry-populate.ts:10`) là **một cửa duy nhất**
  mọi giá trị `dry()` đi qua (`get`/`list`/`populate`) → chỗ duy nhất cần gắn
  provenance.
- `render.ts` tự sở hữu toàn bộ document → chèn script overlay là một dòng.
- `field-events.ts` được viết sẵn cho **đúng** tình huống này: *"Lets code
  outside this bundle entirely - an AI assist feature, a browser extension,
  any other plugin - observe and drive the entry/singleton edit form ... Plain
  `window` `CustomEvent`s on purpose"*. Đây là cầu iframe↔trang, không phải
  phát minh mới.
- `?_field=` deep link + `.entry-field-highlight` (`field-events.ts:96`) đã có
  → "mở đúng field vừa click" là tính năng sẵn có.
- `setValueAtPath` (`field-path.ts`) đã hỗ trợ path lồng `data.0.name.label`
  → **field sâu bên trong component/repeatable được hỗ trợ từ đầu**.
- Draft IndexedDB theo origin → sửa ngoài trang public hiện luôn trong editor.
- `pages-cache` invalidate theo `getResourceVersion(type)` → save xong trang tự
  đổi.

## Quyết định đã chốt

Chốt hết để làm một lượt. Muốn đổi thì đổi **trước** khi bắt đầu code.

1. **Format marker: chuỗi inline, không registry.**
   `data-dry="c:blog:12:hero.name:string"` (`c`=collection/`s`=singleton, tên
   type, id entry, path field, kiểu field).
   *Đổi so với bản nháp trước*: registry đánh số cần state theo request bên
   trong một hook Preact toàn cục → hỏng khi 2 render chạy song song; còn lợi
   thế duy nhất của registry (chở label/config) thì vô nghĩa vì iframe editor
   tự nạp schema rồi. Chuỗi inline **không cần escape**: tên type/field bị
   `naming.ts` ép `/^[a-z][a-z0-9]*$/i`, id là số, path chỉ có dấu chấm và
   chữ số → `:` không bao giờ xuất hiện trong thành phần nào.
   Dùng **id**, không dùng slug (slug đổi được, write API key theo id).
2. **Lớp 1 chỉ box chuỗi** (`string`/`text`/`richtext`), **không bao giờ box
   `id` và field hệ thống**. `number`/`boolean`/`date` không box (`new
   Boolean(false)`/`new Number(0)` truthy → lật ngược `{post.featured && ...}`).
   Chúng dùng Lớp 2.
3. **Một element nhiều field**: `data-dry="ref1 ref2"` (ngăn bằng khoảng
   trắng), click mở dialog theo ref đầu, dialog liệt kê cả hai. **Không chèn
   `<span>` bọc** (phá selector/whitespace của trang).
4. **Auth**: cookie VEI riêng, **không đụng cookie session admin**.
   `POST ${path}/api/vei/session` (cần session + CSRF) →
   `Set-Cookie: dry_vei=<token ký>; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800`.
   Cộng cookie gợi ý `dry_admin=1` (Path=/, **không** HttpOnly, không chứa bí
   mật) đặt lúc login/refresh, xoá lúc logout → nút nổi hiện được trên trang đã
   cache mà khách vãng lai không tốn request nào.
5. **Dialog = iframe**, trỏ vào editor có sẵn
   `${path}/content/:typeSlug/:id?_field=<top-level>&_vei=1`. Không route mới.
   Lý do đầy đủ ở mục "Vì sao iframe" bên dưới.
6. **Preview = patch DOM trực tiếp** qua marker, nghe `dry:field-input` từ
   iframe. Không render lại server. Giới hạn: không phản ánh thay đổi phái sinh
   (sort, điều kiện render, `formatDate`).
7. **Save**: mỗi entry một lần lưu, chạy tuần tự, gom nhóm theo collection chỉ
   ở UI tiến trình. Thực thi bằng cách **dùng lại chính đường save của
   `ContentEntryEditor`** (xem "Luồng Save"), không trích xuất/nhân bản logic.
8. **Phạm vi field v1**: `string`/`text`/`richtext`/`select`/`image`/`number`/
   `boolean`/`date` (mọi field editor render được, vì dialog là editor thật).
   `relation` và thêm/xoá/đổi thứ tự item repeatable: sửa được **trong dialog**
   (form đầy đủ), nhưng **không** có marker riêng trên trang.

## Vì sao iframe (không shadow root, không mount thẳng)

- *Mount thẳng - loại*: site dùng Tailwind v4 (`src/apps/globals.css`),
  preflight là selector trần (`*`, `button`, `h1..h6`, `img`). Ai thắng phụ
  thuộc thứ tự khai báo `@layer` giữa hai stylesheet, tức thứ tự load - không
  phải thiết kế.
- *Shadow root - loại*: `useOutsideClick` (`src/hooks/list-nav.ts:88`) nghe
  `pointerdown` trên `document` rồi `el.contains(event.target)`. Trong shadow
  root `event.target` bị retarget về host → `contains()` luôn false → **Select/
  Combobox/MultiSelect/DatePicker đóng ngay khi click vào popup của chính nó**,
  đúng bộ component tạo nên dialog. Sửa được bằng `composedPath()` nhưng đụng
  logic toạ độ mobile backdrop đã fix trước đó. Cộng: RichText đã tự
  `attachShadow` (`useRichTextEditor.ts:236`) → shadow lồng shadow, ProseMirror
  selection ở độ sâu 2 chưa kiểm chứng; và phải nạp ~210KB CSS admin qua
  `?inline` + `adoptedStyleSheets`.
- *CSS admin vốn đã không rò ra site*: `index.css`/`base.css` namespace toàn bộ
  dưới `.dry` trong `@layer`, comment ghi rõ "nothing leaks into the host
  site's own pages" → shadow root không giải quyết vấn đề nào còn tồn tại.
- *iframe còn giải luôn quyết định #4 cho đường ghi*: iframe nằm dưới `/dry` →
  cookie session + CSRF đi tự nhiên, trang public không cần quyền ghi.
- Overlay chrome (nút nổi, thanh công cụ, outline) **thì** dùng shadow root -
  đó là code mới của mình, không dính `useOutsideClick`, và cần chặn Tailwind
  của site.

## Field sâu bên trong

Yêu cầu: `{blog.hero.name}` (component), `{blog.blocks[2].title}` (repeatable)
phải nhận diện được như field thường. Cách làm:

- **Box deep-walk**: `toRecord` đi đệ quy qua giá trị `flatten` (component) và
  mảng `component-repeat`, box từng lá chuỗi với path đầy đủ
  (`hero.name`, `blocks.2.title`) - đúng cú pháp `setValueAtPath` đang dùng.
- **`$` proxy** cũng lồng: `post.$.hero.name`, `post.$.blocks[2].title`.
- **Ghi**: `dry:field-set` đã nhận path lồng sẵn → không cần thêm gì.
- **Mở dialog**: `?_field=` chỉ khớp **tên field top-level** (`scrollToField`
  dùng `FIELD_ANCHOR_ATTR` trên node top-level) → truyền `_field=hero` để cuộn
  tới field cha, kèm `_path=hero.name` để bridge highlight control con.
- **Preview**: `dry:field-input` chỉ phát theo tên top-level và trả value của
  **cả object component** → overlay phải tự lấy sâu xuống theo path trong
  marker. Đây là chỗ duy nhất field sâu tốn thêm code thật.

## Luồng end-to-end

1. Admin duyệt trang public bình thường (HTML từ cache). Script overlay thấy
   cookie `dry_admin=1` → hiện nút nổi góc trái.
2. Bấm nút → overlay `POST ${path}/api/vei/session` (qua `fetch` credentials
   include, cùng origin) → nhận cookie `dry_vei` (Path=/) → `location.reload()`.
3. `page-handler.ts` thấy `dry_vei` hợp lệ → `editMode`, bỏ qua pages-cache
   đọc/ghi, trả `Cache-Control: no-store`.
4. Render: `toRecord` box chuỗi (chỉ với type user có quyền update), hook
   `options.vnode` gắn `data-dry`/`data-dry-src`/`data-dry-html`.
5. Overlay bật outline `--dry-primary` trên `[data-dry]`. Click → mở iframe
   full-viewport tới editor entry đó.
6. Gõ trong iframe → `dry:field-input` → bridge `postMessage` → overlay patch
   DOM theo marker (live preview). Editor tự ghi draft IndexedDB như thường.
7. Đóng dialog. Sửa tiếp field/entry khác.
8. Bấm Save trên thanh nổi → agent iframe ẩn lần lượt mở từng entry có draft,
   phát `dry:entry-save`, chờ `saved`, sang entry kế. Xong → `location.reload()`
   (pages-cache đã tự hết hạn vì `getResourceVersion` nhảy).
9. Bấm Thoát → `DELETE ${path}/api/vei/session` xoá cookie → reload về trang
   thường.

## Luồng Save (chi tiết - vì sao không trích xuất logic)

Logic save nằm trong `ContentEntryEditor.tsx` (25K). Trích ra để gọi từ trang
public là rủi ro lớn nhất trong toàn bộ kế hoạch này. Thay vào đó: thêm sự kiện
`dry:entry-save` vào `field-events.ts` (cùng idiom file đó đã dựng sẵn cho
`dry:field-set`), `ContentEntryEditor` lắng nghe và chạy **đúng** hàm save nó
đang có. Agent iframe điều phối tuần tự. Không nhân bản một dòng logic nào.

## File - tạo mới

| File | Việc |
| --- | --- |
| `src/content-types/dry-vei.ts` | Lõi isomorphic: `DryRef`, `encodeRef`/`decodeRef` (format #1), `boxString(value, ref)`, `refOf(value)`, `unbox(value)`, `$`-proxy, `installVnodeHook()`. Không import `node:*`. |
| `src/content-types/dry-vei.test.ts` | Unit: encode/decode, deep-walk path lồng, không box `id`, hook gắn đúng attribute (children/attr/`__html`). |
| `src/server/routes/vei.ts` | `POST`/`DELETE ${path}/api/vei/session` - ký/xoá cookie `dry_vei` bằng `session-token.ts`. |
| `src/server/vei-session.ts` | `readVeiCookie(request)` + `resolveVeiSession()` cho `page-handler.ts`. |
| `src/apps/vei/overlay.ts` | Entry client phía site: nút nổi, bật/tắt edit mode, outline, click→iframe, nhận `postMessage` patch DOM, thanh Save/Preview/Thoát. Toàn bộ UI trong shadow root riêng. |
| `src/apps/vei/overlay-styles.ts` | CSS chuỗi cho shadow root overlay (kèm token `--dry-primary`). |
| `src/pages/vei/VeiBridge.tsx` | Phía admin, nạp khi `?_vei=1`: cầu `dry:field-input`/`dry:field-set`/`dry:entry-save` ↔ `postMessage`. |
| `src/pages/vei/VeiAgent.tsx` | Route ẩn `${path}/vei-agent`: điều phối save tuần tự nhiều entry theo draft index. |
| `e2e/vei.spec.ts` | E2E: vào edit mode, sửa 1 field thường + 1 field lồng, preview đổi, save, reload thấy giá trị mới. |

## File - sửa

| File | Việc |
| --- | --- |
| `src/content-types/dry-context.ts` | Thêm `vei?: { canUpdate(typeName): boolean }`. |
| `src/content-types/dry-populate.ts` | `toRecord(row, type?, context?)` - box khi có `context.vei`, deep-walk `flatten`/`component-repeat` theo `buildEntryFieldTree`. Sửa cả `fetchPublished`. |
| `src/content-types/dry-reader.ts` | Truyền `type`+`context` vào 3 chỗ gọi `toRecord`; gắn `$` vào record trả về. |
| `src/content-types/codegen.ts` | Sinh `$: DryRefs<T>` (mapped type đệ quy) cho mỗi interface → Lớp 2 type-safe. **Đây là mảnh cắt được đầu tiên nếu cần giảm scope** (runtime `$` vẫn chạy, chỉ mất autocomplete). |
| `src/content-types/engine/entry-where.ts` | `valueOf()` chuẩn hoá value trước khi bind - lưới an toàn cho box lọt vào SQL. |
| `src/storage/http-source.ts` | `resolveImageSrc` forward ref khi input là box → `<img src={imageUrl(post.hero)}>` tự nhận diện. |
| `src/server/app-router/render.ts` | Bọc **cả** `renderToStringAsync` trong `runWithDryContext` (hiện chỉ bọc `resolveMatchToVNode`); chèn `<script>` overlay + `no-store` khi edit mode. |
| `src/server/page-handler.ts` | Đọc/verify `dry_vei`, dựng `canUpdate` từ `access.ts`/`permissions.ts`, set `vei` vào context, bỏ qua cache 2 chiều khi edit mode. |
| `src/server/handler.ts` | Đăng ký route `vei.ts`. |
| `src/server/routes/auth.ts` | Đặt/xoá cookie gợi ý `dry_admin=1`; xoá `dry_vei` khi logout. |
| `src/routers/App.tsx` | `?_vei=1` → render route **không** bọc `DryLayout` (đã có tiền lệ: `AuthGate` render Sign in không chrome) + nạp `VeiBridge`; thêm route `${path}/vei-agent`. |
| `src/pages/content-entry-editor/field-events.ts` | Thêm `dry:entry-save` (+ `dry:entry-saved`), cùng idiom sẵn có. |
| `src/page-components/ContentEntryEditor.tsx` | Lắng nghe `dry:entry-save` → gọi hàm save hiện có; đọc `_path` để highlight control con. |
| `vite.config.ts` | Thêm input `appsVei: "src/apps/vei/overlay.ts"`. |
| `src/server/app-router/assets.ts` + `asset-hrefs-plugin.ts` + `generated-asset-hrefs.ts` | Thêm `VEI_OVERLAY_HREF` theo đúng đường `HYDRATE_ENTRY_HREF` đang đi. |

## Thứ tự thực thi (6 bước, mỗi bước verify được)

1. **Lõi + auth.** `dry-vei.ts` + test, `vei.ts`/`vei-session.ts`, cookie gợi ý,
   `page-handler.ts` nhận `editMode`.
   *Verify*: `curl` với/không cookie → HTML khác nhau ở header `no-store`.
2. **Lớp 2 (`$` + marker tường minh).** `dry-reader.ts` gắn `$`, hook
   `options.vnode`, `render.ts` bọc ALS + chèn script.
   *Verify*: một trang test dùng `<h1 {...dryBind(post.$.title)}>` ra đúng
   `data-dry`.
3. **Overlay.** Nút nổi, outline, thanh công cụ, mở iframe.
   *Verify*: click field → iframe mở đúng entry, đúng field được highlight.
4. **Bridge + preview.** `VeiBridge`, `?_vei=1` bare mode, patch DOM.
   *Verify*: gõ trong iframe → chữ trên trang đổi theo, kể cả field lồng.
5. **Save.** `dry:entry-save`, `VeiAgent`, tuần tự nhiều entry.
   *Verify*: sửa 2 entry khác collection, Save, reload thấy cả hai.
6. **Lớp 1 (magic).** Box trong `toRecord` (deep-walk), `resolveImageSrc`
   forward, `valueOf()` trong `entry-where.ts`, codegen `$`.
   *Verify*: `blogs/[slug]/page.tsx` **không sửa dòng nào** mà `{post.title}`,
   `{category?.title}`, richtext, `<img src>` đều có marker; `where: category.id`
   vẫn query đúng.

Làm Lớp 2 (bước 2) trước Lớp 1 (bước 6) là cố ý: toàn bộ phần đắt (overlay,
bridge, preview, save) dùng chung, nên chạy hết vòng đời bằng đường an toàn
trước rồi mới bật magic - ngược lại sẽ phải debug boxing trước khi biết vòng
đời có chạy không.

## Cạm bẫy đã xác minh trong code

1. **Cookie session `Path=/dry`** (`auth.ts:176`) → trang public không có
   session. Đã giải bằng quyết định #4.
2. **Boxing lật ngược logic trang**: `blogs/[slug]/page.tsx:48` truyền
   `category.id` vào `where` → box sẽ làm driver ném khi bind. Đã giải bằng
   quyết định #2 (không box `id`) + `valueOf()` ở `entry-where.ts`.
3. **Hook `options.vnode` chạy ngoài ALS**: `render.ts:117` chỉ bọc
   `resolveMatchToVNode`, còn component con render trong
   `renderToStringAsync` ở dòng 120 - ngoài context. Phải bọc cả hai. (Với
   format marker inline thì hook không cần ALS, nhưng `$`/box vẫn cần.)
4. **Hydration**: `hydrate-client.ts` replay callLog qua JSON → giá trị client
   là chuỗi trần, vnode client không có `data-dry`. **Không cần box lại phía
   client**: preact hydrate không ghi đè attribute trên DOM sẵn có, và diff sau
   đó so oldProps↔newProps đều không chứa `data-dry` nên không xoá. Đây là giả
   định phải **kiểm bằng e2e** (bước 6), không phải đóng đinh - nếu sai thì
   fallback là box lại trong `dry-reader-client.ts` kèm nhúng lát schema mỏng.
5. **Preview patch DOM tách khỏi vnode tree** → mọi re-render của Preact sẽ
   xoá kết quả preview. Edit mode là trang tĩnh nên chấp nhận được; đừng gọi
   `hydrate` lại.

## Không làm ở lần này

- Sửa tại chỗ (contenteditable trực tiếp trên trang) - dialog trước đã.
- Marker cho `relation`/thêm-xoá item repeatable trên trang.
- `?_only=<field>` để dialog chỉ hiện một field (v1 hiện nguyên form, cuộn tới
  đúng field).
- Preview mode phía server (đọc draft khi SSR) - vẫn là việc của
  `plans/reader.md` Giai đoạn 4.

## Quy mô thật

8 file mới + 15 file sửa + unit test + 1 e2e. Cắt được nếu cần: bỏ bước 6
(magic) còn ~60% khối lượng, VEI vẫn chạy đủ qua `$`/`dryBind` tường minh;
bỏ codegen `$` typing tiết kiệm thêm chút nữa mà không mất tính năng runtime.
