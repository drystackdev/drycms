# Kế hoạch: Component trong Page Editor

Ý tưởng gốc (giữ nguyên, đã mở rộng thành plan đầy đủ bên dưới):

- Trong trang `/dry/page-editor?file=`, chỗ hiện file cần thêm chỗ lưu
  component; 2 tab: **page**, **component**.
- Bản chất 1 component là 1 file `.tsx` có `export default`.
- Tại page có thể dùng `@component` để import các file, có nhắc lệnh.
- Chỗ preview sẽ gọi default export và preview; dựa trên type props đã khai
  báo, tự sinh một object có nội dung phù hợp theo type.
- Ngoài ra có thể `export const _preview` làm props preview cho component đó.

Plan này **thay thế** `plans/component-builder.md` (đã xoá) - Component
Builder cũ (`/dry/page-components`, store riêng `.dry/components`) bị gộp
hẳn vào Page Editor, xem mục 8.

## Các quyết định đã chốt

| Câu hỏi | Chốt |
| :-- | :-- |
| Component lưu ở đâu | Trong pages-source, thư mục gốc riêng |
| Bố cục pages-source | Tách `pages/` và `component/` (trước đây page nằm thẳng ở gốc) |
| Preview render ở đâu | Iframe qua `buildPage()` (CSS site + Tailwind thật) |
| Sinh props tự động | TS worker của `Editer` đọc type thật của default export |
| Trang `/dry/page-components` cũ | Xoá, gộp vào Page Editor, dùng chung quyền Page Builder |

## 1. Bố cục mới của pages-source: các "thư mục gốc"

Trước: page nằm thẳng ở gốc `pagesSourceStorage`. Sau:

```
.dry/pages-source/          (R2 prefix tương ứng khi kind: "cloudflare")
├── pages/                  ← route: page.tsx / layout.tsx / 404.tsx / 500.tsx
│   ├── layout.tsx
│   ├── page.tsx
│   └── blogs/[slug]/page.tsx
└── component/              ← component: .tsx có export default
    ├── Card.tsx
    └── ui/Button.tsx
```

Danh sách thư mục gốc khai báo ở **một chỗ duy nhất**
(`src/server/app-router/source-roots.ts`) để sau thêm root mới chỉ sửa 1 file:

```ts
export const PAGES_SOURCE_ROOTS = [
  { id: "pages",     label: "Page" },
  { id: "component", label: "Component", alias: "@component" },
] as const;
```

Bản materialize build-time (gitignored, `sync-pages-r2.ts`) map 1-1 theo tên
root, nên `src/apps/pages/**` giữ NGUYÊN ý nghĩa cũ (chỉ chứa route):

| storage | git (build-time only) |
| :-- | :-- |
| `pages/**` | `src/apps/pages/**` |
| `component/**` | `src/apps/component/**` |

Nhờ tách root, không cần luật "thư mục dành riêng" nào cả: route discovery
chỉ đọc trong root `pages`, nên `component/page.tsx` không bao giờ thành
route - miễn phí, không có guard riêng phải nhớ.

**Di trú**: `.dry/pages-source` trên máy dev đang rỗng nên local không mất
gì. Nếu R2 production đã có page ở gốc thì phải chuyển vào `pages/` (kéo
xuống bằng `--local`, di chuyển, `pages:sync --push --remote`) - ghi rõ
trong `status/component.md`.

## 2. Alias `@component/<path>`

`@component/Card` ⇔ file `component/Card.tsx` (thử thêm `.tsx`, `.ts`; bỏ
đuôi `.js`/`.jsx` nếu gõ theo kiểu NodeNext như code page hiện tại). Luôn
phân giải từ **gốc pages source**, không phụ thuộc file đang import - nên
page ở bất kỳ độ sâu nào cũng viết y hệt nhau.

Phải khai báo alias ở 4 nơi, vì page được compile qua 4 đường khác nhau:

| Đường | File | Việc cần làm |
| :-- | :-- | :-- |
| Build trong browser (preview + Build + VEI rebuild) | `src/page-components/page-build.ts` | `resolveModulePath` nhận `@component/`; `IMPORT_FROM_RE` khớp thêm `@component/...` để `localImportsOf`/`transitiveDependencies`/`rewriteEsmImports` thấy được |
| Dev SSR (Vite đọc file thật trong `.dry/pages-source`) | `vite.config.ts` | `resolve.alias` khi `command === "serve"` → `<cwd>/.dry/pages-source/component` |
| Build Worker/Node (`src/apps/**` đã materialize) | `vite.config.ts` | cùng alias, khi build → `<cwd>/src/apps/component` |
| Type-check trong editor | `src/components/Editer/ts-worker.ts` | `resolveModuleName` map `@component/X` → `/component/X.tsx` trong virtual FS |

Thêm `paths` trong `tsconfig.json` để IDE/`bun run typecheck` cũng hiểu
`@component/*` (tsconfig đã include `.dry/pages-source/**/*.tsx`).

## 3. UI: 2 tab trong sidebar Page Editor

`ComponentTreePanel` giữ nguyên, không sửa - Page Editor lọc `entries` theo
root rồi truyền vào cùng một panel. Quan trọng: **`id` của entry giữ nguyên
path đầy đủ** (`pages/blogs/page.tsx`), chỉ ẩn entry thư mục gốc và đổi
`parentId` của con trực tiếp thành `null` để cây hiện gọn từ trong root -
nhờ vậy `selectedPath`, URL `?file=`, mọi handler save/move/delete không phải
đổi gì.

- Tab **Page**: mọi entry KHÔNG thuộc root khác (kể cả file lạc ở gốc, để
  không có file nào bị ẩn khỏi UI).
- Tab **Component**: entry dưới `component/`.
- Tab đang mở suy ra từ `selectedPath`, cộng state riêng để đổi tab khi chưa
  chọn file; lưu trong `PageEditorUiState` (localStorage) như các panel khác.
- Tạo file/thư mục ở gốc cây thì tự gắn prefix của tab đang mở.

File component mới sinh sẵn nội dung mẫu dạy luôn API:

```tsx
interface Props {
  title: string;
}

export default function Component({ title }: Props) {
  return <div>{title}</div>;
}

export const _preview: Props = { title: "Sample title" };
```

## 4. Preview component

Khi file đang chọn nằm dưới `component/`, `previewTarget` trỏ tới một
**entry ảo** `__dry-preview-component.tsx` (chỉ tồn tại trong bản copy
`sourceByPath` cục bộ của `refreshPreview`, không bao giờ ghi xuống storage -
đúng cơ chế `LAYOUT_PLACEHOLDER_PATH` đang dùng cho `layout.tsx`):

```tsx
import __Component, * as __module from "@component/Card";
const __generated = { title: "Sample title" }; // sinh từ type, xem mục 5
export default function DryComponentPreview() {
  const __preview = (__module as { _preview?: unknown })._preview;
  const __list = Array.isArray(__preview) ? __preview : [__preview ?? __generated];
  return <>{__list.map((props, index) => <__Component key={index} {...(props as never)} />)}</>;
}
```

- `_preview` là **object props**, hoặc **mảng object** = nhiều biến thể,
  render lần lượt. Có `_preview` thì luôn thắng object tự sinh.
- `layoutPaths: []` - component preview **đứng độc lập**, không bọc trong
  `layout.tsx` của site (bọc thì nav/footer của layout lọt vào khung
  preview). CSS site vẫn đúng vì `buildPage` tự inline `globals.css` và
  compile Tailwind theo đúng class component dùng.
- Dùng lại nguyên khung preview hiện có: iframe `srcdoc`, toolbar viewport
  xs/sm/md/lg/xl, zoom +/-/Fit, nút Reload.
- Nút **Build** disable khi đang xem component (component không phải một
  trang để publish). Bù lại: **Save một component sẽ đánh dấu mọi `page.tsx`
  phụ thuộc nó là "chưa build"** (chấm vàng có sẵn trong cây), tính bằng
  `transitiveDependencies` của `page-build.ts`.

## 5. Sinh object props từ type

Chia làm 2 nửa, nửa nào cũng test được:

**Nửa trong worker** (`ts-worker.ts`, đã sẵn Language Service cho
diagnostics/completion - không thêm dependency, không thêm worker): lấy type
của default export, lấy signature đầu tiên, lấy type tham số thứ nhất, duyệt
property ra một **schema thuần JSON** (`PropsSchema`), có giới hạn độ sâu và
số property để tránh type bệnh lý. Trả về kèm response `diagnostics` sẵn có,
chỉ bật khi `Editer` được truyền `describeProps` (page thường không cần).

```ts
type PropsTypeNode =
  | { kind: "string" } | { kind: "number" } | { kind: "boolean" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "union"; options: PropsTypeNode[] }
  | { kind: "array"; element: PropsTypeNode }
  | { kind: "object"; fields: PropsField[] }
  | { kind: "node" } | { kind: "function" } | { kind: "unknown" };
```

**Nửa thuần** (`src/page-components/props-sample.ts`, unit test được): biến
`PropsSchema` thành **source code của một object literal** (không phải JSON -
còn phải sinh được `() => {}` cho prop kiểu function). Giá trị mẫu chọn theo
type, có heuristic theo tên prop:

| Tên prop khớp | Giá trị mẫu |
| :-- | :-- |
| `title`, `heading`, `label`, `name` | Title Case của tên prop |
| `description`, `subtitle`, `text`, `content`, `excerpt` | một câu mẫu |
| `href`, `url`, `link`, `to` | `"#"` |
| `src`, `image`, `img`, `avatar`, `photo`, `icon`, `logo` | data-URI SVG placeholder (không gọi mạng) |
| `count`, `total`, `quantity`, `index`, `size` | `3` |
| `price`, `amount`, `cost` | `99` |
| `year` | năm hiện tại |
| còn lại: string / number / boolean | Title Case tên prop / `42` / `false` |
| union literal | option đầu tiên |
| array | 3 phần tử mẫu |
| object | đệ quy |
| `children` / VNode | `"Sample content"` |
| function | `() => {}` |
| không suy được | bỏ prop đó |

Prop optional cũng được sinh (bỏ hết thì component toàn-optional preview
rỗng, vô dụng).

## 6. Nhắc lệnh `@component/...`

`ts-worker.ts` đã có sẵn `computeImportSpecifierCompletions` (TS gốc không
gợi ý được module specifier vì virtual FS không có `readDirectory`) - chỉ cần
thêm nhánh: khi chuỗi đang gõ rỗng hoặc bắt đầu bằng `@`, liệt kê
`@component/<path>` cho mọi extra file dưới `/component/`. Không cần
`CompletionSource` riêng ở client.

Vì `resolveModuleName` cũng hiểu `@component/` (mục 2), page import component
sẽ có **type-check props thật + hover**, không chỉ là chuỗi tự do.

## 7. Route discovery đọc trong root `pages`

- `route-tree.ts`: nhánh dev lọc path bắt đầu bằng `pages/` và gọi
  `buildRouteTree(modules, "pages")`; nhánh prod giữ nguyên glob
  `/src/apps/pages/**` (mapping ở mục 1 đảm bảo đúng nội dung).
- `route-manifest.ts`: `buildManifestRouteTree` dùng `rootPrefix = "pages"`,
  key vẫn là path đầy đủ nên `sourcePathOf` trả về đúng path để `buildPage`
  đọc từ `sourceByPath`.
- `scripts/new-project.ts` ghi starter site vào `pages/`.

## 8. Dọn Component Builder cũ

Store `.dry/components` đang **rỗng** trên máy dev nên không có migration.
Xoá:

- `src/pages/PageComponents.tsx`, `src/pages/page-components/ComponentPreview.tsx`
- `src/page-components/http-api.ts`, `src/page-components/sucrase-eval.ts`
- `src/server/routes/page-components.ts` + test, đăng ký route + gate
  permission trong `handler.ts`
- `DryOption.pageComponents` (`options.ts`, `config.ts`) + test tương ứng
- `PAGE_COMPONENTS_RESOURCE` trong `RoleEditor.tsx`, `PAGE_COMPONENTS_RESOURCE_ID`
- nav item + cờ `temporaryFeatureVisibility.pageComponents`, route trong
  `routers/App.tsx`

Giữ lại (Page Editor đang dùng): `ComponentTreePanel.tsx`,
`useDevicePreview.ts`, `tree.ts`, `import-rewrite.ts`.

Quyền: tab Component dùng chung `PAGE_BUILDER_RESOURCE_ID` với Page Editor -
không còn cảnh có quyền Page Builder nhưng tab Component trả 403.

## 9. Test

- `page-build.test.ts`: phân giải `@component/`, và `rewriteEsmImports` cho
  specifier `@component/` khi sinh JS asset.
- `route-tree.test.ts` / `route-manifest`: chỉ root `pages` thành route,
  `component/page.tsx` thì không.
- `props-sample.test.ts` (mới): schema → source object literal.
- `component-preview.test.ts` (mới): sinh source entry ảo + lọc entry theo
  root cho 2 tab.
- `bun run typecheck` + toàn bộ `bun run test`.
- QA thật trên trình duyệt theo `docs/DESIGN.md` (2 theme, computed style chứ
  không chỉ screenshot): tạo component, gõ props, xem preview tự sinh,
  `_preview` đè lên, import `@component/` trong page + nhắc lệnh, build page
  dùng component, đổi tab, rename/move component.

## 10. Ngoài phạm vi lần này

- Chèn component vào page bằng UI kéo-thả (đó là việc của page builder).
- Preview component bọc trong layout site (đang cố tình đứng độc lập).
- Sinh props cho type generic nhiều lớp - suy được tới đâu dùng tới đó, không
  suy được thì bỏ prop.
