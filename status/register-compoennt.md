## Đăng ký component tuỳ biến cho richtext editor

(Chỉ tính component người dùng tự định nghĩa trong code của họ. "Kho riêng"/
market để sau, không thiết kế ở đây.)

### 1. Quy ước 1 file component

Mỗi component là 1 file trong thư mục quy ước, VD `src/dry-components/Carousel/index.tsx`:

```tsx
export default DryEditerComponent({
  name: "carousel", // -> <dry-carousel>
  label: "Carousel",
  type: "inline", // "inline" | "block", default "inline"
  shadow: false, // gắn shadow root riêng cho component này, default false
  props: (p) => p({
    name: p.string().default("Khan Tran"),
    age: p.int().required(),
    roles: p.array(p.string()),
    profile: p.object({ address: p.string().required() }),
  }),
  component: ({ name, age, roles, profile }) => ( ... ), // props tự có type đúng, không khai Props riêng
});
```

`DryEditerComponent(...)` là marker duy nhất để bước discover (mục 2) nhận
diện file hợp lệ (brand nội bộ trên object trả về) - không cần export rời
`command`/`label`/`props` như bản nháp đầu.

**Props builder kiểu Zod nhưng tự viết** (không thêm dependency `zod`):
`p.string()`, `p.int()`, `p.image()`, `p.array(T)`, `p.object({...})`, chain
`.required()` (mặc định optional), `.default(value)` gắn thẳng vào field
tương ứng - không tách 2 object `schema`/`defaults` phải khớp key tay.

Type tự sinh từ builder qua conditional type đệ quy
(`InferField`/`InferSchema`), không viết tay `interface Props`. Nếu định
nghĩa `component` tách rời (không viết inline) thì lấy type qua:
```ts
type Props = InferSchema<ReturnType<typeof myProps>>;
```

### 2. Discover - build/dev time, không phải lúc runtime

`import.meta.glob("<componentsDir>/*/index.tsx")` quét ra map
`{ path -> () => import(...) }` ngay trong app của người dùng (dev server
hoặc `astro build` bình thường). Không tự viết bundler/script build riêng,
không chạy lúc admin bấm "xác nhận dùng" - môi trường deploy có thể là edge/
serverless, không chạy bundler tại request time được.

`componentsDir` cấu hình qua `dry({ richtext: { componentsDir } })`, mặc
định 1 path quy ước, resolve theo `process.cwd()` của app Astro consumer
(giống `storage`/`icons`/`content` hiện có).

`import.meta.glob` bị Vite xử lý tĩnh tại đúng vị trí gọi, không thể nằm
trong `packages/drycms/dist` đã build sẵn. Cần 1 virtual module mới (VD
`virtual:drycms/richtext-components`), theo đúng pattern
`virtual:drycms/icons-config` trong `integration/virtual.ts` - integration
tự sinh nội dung module chứa `import.meta.glob(...)` trỏ vào
`componentsDir` đã resolve.

### 3. Trang quản trị component

Trang mới (giống Icon Management/File Manager về hình dạng):

- liệt kê mọi file quét được có marker `DryEditerComponent` hợp lệ (kể cả
  chưa "xác nhận dùng") - hiện `label`/`type`, preview bằng
  `<ComponentPreview name defaults load />` (component dùng chung với popup
  chèn ở mục 4 - cùng framework Preact với admin UI nên render thẳng, không
  cần iframe/sandbox)
- `ComponentPreview` tự bọc 1 Preact error boundary riêng bên trong - 1
  component lỗi lúc render không kéo sập cả trang/dialog, chỉ item đó báo
  lỗi tại chỗ
- nút "Xác nhận dùng" - resolve `props(p)` để lấy `{ schema, defaults }`
  (plain object, không lưu hàm), ghi 1 JSON record `{ label, type, props,
  name, sourcePath, enabled: true, shadow }` vào storage
- record lưu ở storage root riêng, giống `icons`
  (`ResolvedStorageOption`, multi-backend local/github/gitlab), cấu hình qua
  `dry({ richtext: { storage } })`

### 4. Chèn component vào editor - dialog dạng grid + preview, chọn rồi thêm

Giống pattern picker của `image-insert-button.tsx` (dialog riêng, chọn xong
mới chèn), không phải chèn thẳng từ danh sách toolbar:

- mở dialog: liệt kê toàn bộ record `enabled: true` từ storage, mỗi ô là 1
  `<ComponentPreview name defaults load />` (dùng chung với mục 3) - load
  **song song, không chặn việc mở dialog**; ô nào chưa load xong hiện
  skeleton placeholder, load xong tự thay bằng `<Comp {...defaults} />` thật
- click 1 ô để **chọn** (highlight, chưa chèn ngay) - giữ `pending` state,
  chưa dispatch gì cả
- nút "Thêm" mới thật sự chèn - vị trí chèn chốt **từ lúc mở dialog**
  (`anchorPosRef.current = view.state.selection.to`, y hệt
  `image-insert-button.tsx`), vì dialog mở làm mất focus editor nhưng
  ProseMirror state không mất theo nên vẫn giữ được vị trí cũ
- lệnh insert thật **rẽ nhánh theo `type`**, không dùng chung 1 lệnh:
  - `inline` → y hệt `image-insert-button.tsx`:
    `view.dispatch(view.state.tr.insert(pos, node))` tại vị trí đã chốt
  - `block` → tái dùng pattern `insertTable` (`table.ts`):
    `state.tr.replaceSelectionWith(node)`, cộng 2 case biên đã có sẵn lời
    giải ở đó - đang đứng trong `grid_item` thì route qua
    `insertBlockAfterFocusedGridItem`, chèn ở cuối tài liệu thì thêm 1
    `paragraph` rỗng theo sau để con trỏ có chỗ đứng
- node tạo bằng `schema.nodes[\`dry_${name}\`].create({ props: defaults })`
  (defaults lấy từ record đã resolve ở mục 3)

### 5. Schema ProseMirror - node động thay vì hard-code

`schema.ts` cần 1 hàm `buildSchema(components)` thay vì `export const schema
= new Schema(...)` cố định - `useRichTextEditor.ts` gọi hàm này với registry
đọc từ mục 3/4 thay vì import `schema` tĩnh. Mỗi component `enabled` sinh 1
node spec, atom + không có `content` (leaf, không con - khác `grid`/`table`
đang có children):

```ts
type: "inline" -> { group: "inline", inline: true, atom: true, attrs: { props: { default: {} } }, ... }
type: "block"  -> { group: "block", atom: true, attrs: { props: { default: {} } }, ... }

toDOM(node) {
  return [`dry-${name}`, { props: JSON.stringify(node.attrs.props) }]; // KHÔNG có hole `0` - node này không có con
},
parseDOM: [{
  tag: `dry-${name}`,
  getAttrs(dom) {
    try { return { props: JSON.parse(dom.getAttribute("props") ?? "{}") }; }
    catch { return { props: {} }; } // JSON hỏng (sửa tay HTML) không crash editor
  },
}],
```

### 6. Xuất HTML (`html.ts`)

`html.ts` build HTML bằng string thủ công (không qua `DOMSerializer`/
`outerHTML` thật), nên **phải tự đóng thẻ tường minh** - custom element
không nằm trong danh sách void element của HTML5, cú pháp tự đóng `/>` bị
trình duyệt bỏ qua khi parse HTML thật, nuốt luôn phần nội dung phía sau làm
con của nó tới khi gặp `</dry-{name}>` (hoặc không bao giờ gặp thì hỏng cả
phần còn lại của tài liệu):

```ts
`<dry-${name} props="${escapeAttr(JSON.stringify(props))}"></dry-${name}>`
```

dùng lại `escapeAttr` sẵn có trong `html.ts`, không viết escape riêng.

### 7. Custom element - tự viết wrapper, không thêm `preact-custom-element`

Chỉ cần đọc đúng 1 attr `props` (JSON blob) rồi render - không cần generic
attribute-per-prop mà lib đó giải quyết:

```ts
function defineDryComponent(name: string, load: () => Promise<{ default: ComponentType<any> }>, shadow: boolean) {
  customElements.define(`dry-${name}`, class extends HTMLElement {
    static observedAttributes = ["props"];
    #Comp: ComponentType<any> | null = null;
    connectedCallback() {
      const root = shadow ? (this.shadowRoot ?? this.attachShadow({ mode: "open" })) : this;
      load().then((m) => { this.#Comp = m.default; this.#render(root); });
    }
    attributeChangedCallback() { if (this.#Comp) this.#render(this.shadowRoot ?? this); }
    disconnectedCallback() { render(null, this.shadowRoot ?? this); }
    #render(root: Element | ShadowRoot) {
      let props = {};
      try { props = JSON.parse(this.getAttribute("props") ?? "{}"); } catch {}
      render(h(ErrorBoundary, { children: h(this.#Comp!, props) }), root); // cùng error boundary như preview mục 3
    }
  });
}
```

`shadow: true` → gắn shadow root riêng cho component đó, lồng bên trong
shadow root của `.richtext-content` (nếu đang ở trong editor) - trình duyệt
hỗ trợ native, không cần xử lý gì thêm. CSS bên trong shadow đó là việc của
tác giả component tự inject, không phải việc của `drycms`.

1 hàm `defineDryComponent` dùng chung cho cả editor lẫn trang publish - chỉ
khác `load` (cùng đọc từ map `import.meta.glob` ở mục 2) và nơi gọi.

### 8. Script đăng ký trên trang đã publish (mảnh còn thiếu)

`<dry-carousel props="...">` trong HTML xuất ra **trơ** (không tự chạy gì)
cho tới khi có script gọi `defineDryComponent` cho từng `name`. Cần 1 client
entry mới (VD `drycms/richtext-runtime`) mà layout/page chứa richtext field
phải include - đọc danh sách component `enabled: true` từ storage (mục 3)
rồi gọi `defineDryComponent(name, load, shadow)` cho từng cái, chạy ở
context trang thật thay vì admin UI.

### 9. Chọn / xoá / dialog nhập props

- chọn/xoá node: tái dùng `NodeSelection` mặc định của ProseMirror (xoá bằng
  phím) + pattern `selectNode`/`deselectNode` (`.is-selected` outline) như
  `image-view.ts`
- nút "settings" neo góc trên-phải: floating menu như `image-menu.tsx`/
  `table-menu.tsx`, chỉ hiện khi `props` schema không rỗng
- dialog nhập liệu tái dùng widget input có sẵn (`TextField`/`ImageField`/...
  trong `content-entry-editor/ScalarField.tsx`) - KHÔNG tái dùng toàn bộ
  `content-types/field-registry.ts` (hệ đó gắn DB/relation, nặng hơn nhiều so
  với 1 object props cục bộ trong 1 node)
- `p.object({...})` lồng → render đệ quy 1 fieldset con; `p.array(...)` →
  render nhóm repeatable (tái dùng UI repeatable-Component đã có ở
  content-entry)
- `.required()` → lỗi hiện inline trên field (không dùng toast), theo rule
  chung của app

### Còn mở

- tên/route cụ thể của trang quản trị component, và tên file JSON record
  trong storage (1 file/component hay 1 file gộp danh sách)
- `componentsDir` mặc định là path nào
