# Kế hoạch: Component Builder

Đây là tài liệu về component builder. Các bản nháp trước đó (nếu còn sót
trong lịch sử) đã lỗi thời, không áp dụng cho kế hoạch này.

## Mục đích

Hạ tầng phục vụ cơ chế **page builder** sau này (page builder chưa xây,
plan riêng khi tới lúc). Component Builder chỉ lo phần: viết/lưu/preview
component `.tsx` độc lập - **không** đụng tới nơi các component này sẽ được
dùng lại (đó là việc của page builder).

Đây là tính năng **tách biệt hoàn toàn** với `components.storage` hiện có
trong `src/server/options.ts` (`DryComponentsOption`, default root
`richtext-components`) - chỗ đó phục vụ RichText custom-component bundling
(component "Use" trong RichText), không liên quan Component Builder này.
Vì tên `components` đã bị dùng, option mới trong `DryOption` là
**`pageComponents`** (`DryOption.pageComponents = { storage: { kind, root } }`).

## Lưu trữ

- Backend giống cơ chế lưu icons (`createStorageAdapter`, xem
  `src/storage/index.ts` + `src/storage/local.ts`): cùng interface
  `StorageAdapter` (`list`/`listAll`/`read`/`write`/...), để sau này thêm
  R2/S3 chỉ cần implement thêm 1 adapter, không đổi route/UI.
- **Chỉ phần Component Builder dùng root mới `.dry/components`** (thêm vào
  `.gitignore`). Không đổi default root của `icons/`, `content/`,
  `richtext-components/`, `storage/`, `kv/` hiện có trong đợt này - tránh
  phải migrate dữ liệu cũ trên máy user, giữ scope gọn cho task này. Việc
  gom tất cả các root local về chung `.dry/` là một quyết định kiến trúc
  riêng, để bàn/làm sau nếu cần.
- Component có thể có **thư mục con** (theo yêu cầu) - dùng `listAll()` của
  storage adapter để lấy toàn bộ cây trong 1 lần, dựng cây ở client.
  - Lưu ý: `FileManager.tsx` hiện tại điều hướng theo kiểu drill-down +
    breadcrumb (`folderPath`, `retargetSubtree`, URL `?dry_folder=`),
    **không phải** cây thư mục cố định bên trái. Cây bên trái cho Component
    Builder là UI mới, không tái dùng được `FileManager` nguyên trạng - chỉ
    tái dùng tầng storage/API bên dưới.

## Trang UI

Chia làm 3 vùng:

- **Bên trái**: cây thư mục các component đã lưu (`.tsx` files + folders
  lồng nhau).
- **Trên** (bên phải): preview component, có nút chọn kích thước xem
  trước:
  - 3 nút **Mobile / Tablet / Desktop**: 375px / 768px / 1280px (Mobile
    dưới mốc `sm`=640, Tablet = mốc `md`, Desktop = mốc `xl`).
  - Nút **Reset** về đúng breakpoint đang chọn.
  - Nút **+ / -** để tinh chỉnh riêng lệch khỏi breakpoint mặc định.
  - Khi khung preview to hơn viewport thật của trình duyệt, tự động scale
    xuống vừa khung ngay tại thời điểm bấm đổi kích thước (không phải lúc
    resize cửa sổ).
- **Dưới** (bên phải): code editor cho file `.tsx` đang chọn.

## Code editor: tái dùng `Editer`

Không xây editor mới - dùng `src/components/Editer/Editer.tsx` (plan gốc:
`plans/code-editer.md`), đã có sẵn:

- prism-code-editor + TS Language Service chạy trong Worker: diagnostics,
  completions, hover, signature help, quick fix, format (`Shift+Alt+F`).
- `extraFiles: Record<string, string>` - đúng cơ chế cần cho **"chỉ có thể
  import các file"**: component khác trong cây (không phải npm package) làm
  ambient reference cho TS Language Service, y hệt cách
  `CodeEditerDemo.tsx` đang truyền các tab khác làm `extraFiles` cho nhau.
  Với Component Builder, `extraFiles` sẽ là toàn bộ (hoặc tập liên quan)
  các file `.tsx` khác đã lưu trong cây, keyed theo path tương đối.

`Editer` chỉ lo phần gõ code + type-check, **không** transpile ra JS chạy
được - đó là việc của Sucrase (mục dưới).

## Transpile để render preview: Sucrase

- Dùng **Sucrase** (không dùng `@babel/standalone` như `EditableDemo.tsx`
  đang dùng cho showcase field) - do đã có sẵn ở phần editor với error
  reporting tốt hơn, nhẹ hơn babel, phù hợp chạy trên mỗi lần gõ (giống
  hot-reload).
  - Preset cần: `jsx` + `typescript`, cấu hình JSX pragma cho Preact (`h`)
    hoặc production JSX transform tương ứng.
- Luồng: code từ `Editer` (đã qua diagnostics của TS worker) → Sucrase
  transform → `new Function(...)` như `EditableDemo.tsx` đang làm, hoặc
  cách tương đương để eval và render ra preview pane.
- Giữ nguyên nguyên tắc bảo mật của `EditableDemo`: cơ chế eval code tuỳ ý
  chỉ nên chạy trong ngữ cảnh đã có quyền admin tương đương (trang này chắc
  chắn cần nằm sau permission/auth gate - **cần chốt permission cụ thể**,
  xem mục "Câu hỏi còn mở").

## Shape 1 component

```tsx
export default function () {
  return <div></div>;
}
```

(Tên file = tên component, nằm trong cây thư mục ở trên.)

## Permission

Không dùng admin-only cứng - thêm **permission riêng** trong hệ thống
Role/Permission hiện có (xem `project_drycms_role_permission`), gán được
cho role tuỳ ý, cùng cơ chế enforcement client+server đang áp dụng cho các
trang khác. Tên permission cụ thể (vd `pageComponents.manage`) chốt lúc
code cho khớp naming convention hiện có trong bảng permission.

## Lưu ý CSS khi code phần UI

CSS trong repo đang bị bắt khá chặt (xem `docs/DESIGN.md` - quy tắc
class-vs-attribute, design tokens) - class tự đặt thêm có thể không được
áp dụng nếu không đúng convention. Khi viết CSS mới cho Component Builder
(cây thư mục, khung preview resize, v.v.) **phải đọc lại `docs/DESIGN.md`
trước** và kiểm tra bằng cách thực sự mở trang lên xem, đừng giả định class
tự đặt sẽ ăn.

## Còn lại, chốt lúc code (không chặn bắt đầu)

- API routes cần: list cây, create/rename/move/delete file & folder, get
  nội dung file, save nội dung file - theo đúng pattern
  `src/server/routes/icons.ts` (dùng `route-helpers.ts`, `toFileEntry`,
  `StorageError` → `errorResponse`).
- Tên permission cụ thể trong bảng Role/Permission (xem mục Permission).
