# Kế hoạch: autocomplete Tailwind theo theme của Page Editor

## Vấn đề

Preview/build đã nối `styles/globals.css` với các import cục bộ như
`styles/theme.css`, vì vậy token `@theme inline` tạo ra các utility thật như
`bg-muted` và `text-muted-foreground`. Autocomplete của `Editer` lại chỉ nạp
design system mặc định từ `tailwindcss/index.css`, cache một lần ở module scope,
nên không nhìn thấy utility do project định nghĩa.

Mục tiêu là để autocomplete dùng cùng stylesheet graph đang mở trong Page
Editor, cập nhật khi người dùng sửa theme, nhưng không thay đổi pipeline
preview/build và không làm editor remount hay mất undo history.

## Thiết kế

### 1. Dùng chung một đầu vào stylesheet

- Tái sử dụng `tailwindStylesheetSource(sourceByPath)` để expand
  `styles/globals.css` và toàn bộ relative import giống hệt preview/build.
- `PageEditor.tsx` tạo `tailwindStylesheet` bằng `useMemo` từ `sourceByPath` và
  truyền xuống `Editer` qua prop mới.
- Nếu stylesheet đang tạm lỗi trong lúc gõ (import thiếu, vòng lặp import),
  autocomplete giữ snapshot hợp lệ gần nhất và editor diagnostics/build vẫn là
  nơi báo lỗi; không làm toàn bộ editor biến mất.

### 2. Nạp design system theo project

- Refactor `tailwind-completions.ts` để có loader nhận stylesheet source thay vì
  chỉ có singleton theme mặc định.
- Loader gọi Tailwind design system với stylesheet đã expand; `@import
  "tailwindcss"` vẫn được resolve bằng `tailwindcss/index.css` hiện có.
- Kết quả gồm class, variant và theme-variable list. Theme mặc định là fallback
  ban đầu, còn snapshot project thay thế nó khi load xong.
- Cache theo nội dung stylesheet hoặc fingerprint ổn định, với giới hạn nhỏ,
  để đổi qua lại file không compile lại cùng một theme và để quá trình gõ
  `theme.css` không làm cache tăng vô hạn.

### 3. Gắn snapshot vào từng instance editor

- Mở rộng state trong `instances` của `Editer.tsx` để giữ Tailwind snapshot của
  editor hiện tại.
- Completion source lấy class/variant từ instance được truyền vào, không đọc
  một `classList` module-global. Điều này tránh dữ liệu theme của tenant/editor
  này rò sang editor khác.
- Thêm effect theo `tailwindStylesheet`; load bất đồng bộ với generation token
  hoặc cancellation guard để kết quả cũ không ghi đè theme mới khi người dùng
  gõ nhanh.
- Chỉ thay dữ liệu autocomplete, không remount Prism editor; selection, scroll,
  undo history và worker TypeScript phải được giữ nguyên.
- CSS completion cho `@apply` và `var(--...)` cũng đọc snapshot mới. Nếu API
  `cssCompletion` không hỗ trợ dữ liệu theo instance, bọc/tách riêng source cho
  project theme variables thay vì quay lại global mutable list.

### 4. Hành vi mong muốn

- Trong TSX, gõ `bg-mu` đề xuất `bg-muted`; gõ `text-muted-f` đề xuất
  `text-muted-foreground`.
- Trong CSS, `@apply bg-mu` đưa ra cùng utility và `var(--color-muted...)` thấy
  token project.
- Thêm `--color-brand` trong `@theme` làm `bg-brand`, `text-brand`, v.v. xuất
  hiện mà không reload trang.
- Xóa token làm utility tương ứng biến mất sau khi snapshot mới hoàn tất.
- Tailwind mặc định như `flex`, `bg-red-500`, variants responsive/interaction
  tiếp tục hoạt động.

## Kiểm thử

### Unit

- Loader với stylesheet mặc định vẫn trả các utility/variant chuẩn.
- Loader với `@theme inline { --color-muted: ...; --color-muted-foreground:
  ... }` trả `bg-muted` và `text-muted-foreground`.
- Relative imports được expand qua đúng helper dùng bởi build.
- Hai stylesheet project khác nhau không dùng nhầm snapshot.
- Race test: lần load cũ hoàn tất sau lần mới không được ghi đè kết quả mới.
- Stylesheet tạm lỗi giữ snapshot hợp lệ gần nhất và không tạo unhandled
  rejection.

### Component/integration

- Mount `Editer` với custom theme và xác nhận popup autocomplete có class tùy
  chỉnh trong `class="..."` và `@apply`.
- Đổi prop stylesheet mà không remount, xác nhận suggestion cập nhật và nội
  dung/undo state không mất.

### E2E Page Editor

- Sửa một token tạm trong `styles/theme.css`, mở page/component TSX và xác nhận
  utility mới xuất hiện trong autocomplete.
- Dùng utility đó trong page, xác nhận preview có computed style tương ứng ở cả
  light và dark theme.
- Khôi phục/xóa toàn bộ fixture sau test để không thay đổi source starter.

## Phạm vi file dự kiến

- `src/components/Editer/tailwind-completions.ts`
- `src/components/Editer/Editer.tsx`
- `src/pages/PageEditor.tsx`
- Test mới cạnh `tailwind-completions.ts` và/hoặc `e2e/page-editor.spec.ts`
- Có thể tách helper expand stylesheet khỏi `tailwind-build.ts` nếu cần tránh
  kéo browser compiler vào bundle autocomplete; hành vi helper phải giữ một
  nguồn sự thật duy nhất.

## Tiêu chí hoàn thành

- Hai class starter `bg-muted` và `text-muted-foreground` xuất hiện trong
  autocomplete.
- Custom token thêm/xóa được phản ánh trong cùng session.
- Không remount editor, không mất undo/caret, không làm chậm mỗi keystroke.
- Typecheck, unit test Tailwind/Page Editor và E2E chính đều qua.
