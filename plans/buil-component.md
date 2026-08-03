# Build components

- Trang Custom component hiện tại chỉ là nơi code tạm cần được thay đổi, cơ chế khác
- Trang hiện tại cứ để qua 1 bên trươc

# Trang Component builder

- Có 2 Panel 
- panel 1: 2 row 1 để 
    + preview (tận dụng lại ComponentPreview hiện tại, thêm control chọn preset width/height kiểu breakpoint Mobile/Tablet/Desktop)
    + config name, description, ...
- panel 2: là UI dạng Tabs có 2 tab
    + 1 tab là props builder để tạo ra props (type Props) dùng cho tab 2. Nếu bật cờ children thì tách thêm 1 khung Monaco HTML riêng để nhập `childrenDefaultHtml` (không gộp vào khung TSX chính)
    + 2 tab là khung Monaco TSX - người dùng tự viết toàn bộ nội dung file component (import, export default function(props: Props) {...}, JSX...), không có phần khung sườn tự sinh sẵn. Lúc build sẽ validate/cảnh báo nếu props dùng trong code không khớp schema đã khai ở tab 1

## Lưu trữ & cơ chế build

- Code không còn nằm trong `src/` (bỏ hẳn cơ chế discovery `import.meta.glob` quét `dry.<name>.<ext>` dưới `src/`). Chuyển sang thư mục gốc riêng `dry-component/` (ngang hàng `src/`, cùng kiểu với `icons/`):
    + `dry-component/src/` - code TSX nguồn
    + `dry-component/dist/` - JS đã build
    + Local-only trước mắt (giống `icons/` hiện tại đã bỏ github/gitlab); R2/S3 để tính sau, không làm đợt này
    + Tên hàm định nghĩa component có thể khác `DryComponent` hiện tại, miễn phù hợp với cơ chế mới
- Trang "Custom components" cũ (`RichtextComponents.tsx`) giữ nguyên, không đụng vào - vẫn chỉ hiển thị component cũ có sẵn trong `src/`. Không gộp 2 trang trong đợt này.
- Flow lưu: theo cơ chế staged-apply giống Content Type Editor (draft → review → "Apply and build"), nhưng draft lưu ở **IndexedDB** (không dùng localStorage - lo ngại giới hạn dung lượng với code TSX)
- "Apply and build" build xong là ghi luôn `DryComponentRecord`/enable component, không cần bước "Use in editor" riêng như trang cũ
- Phạm vi bản đầu: chỉ tạo component mới, chưa hỗ trợ mở lại component đã có trong `dry-component/src/` để sửa
- Cần permission riêng cho trang Component Builder (không dùng chung quyền admin hiện tại) - vì đây gần như cho chạy code tuỳ ý lúc build
    
