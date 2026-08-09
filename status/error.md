- khi nhấn build và build all thì các class của tailwind chưa chạy được ví dụ "/" hiện tại thể <div class="p-5">Home</div> có .p-5 nhưng không có css tương ứng
  - ✅ Đã kiểm tra lại trực tiếp (Playwright, click Build và Build all thật trên `/dry/page-build`): trang `/` và `/about` sau khi build đều có `<style>` chứa đúng rule `.p-5`/`.p-3`. `tailwind-build.ts`'s fresh-iframe isolation đã chạy đúng, không cần sửa gì thêm - có vẻ lỗi này đã được fix bởi một thay đổi trước đó trong ngày. Nếu vẫn còn thấy thiếu CSS, cần mô tả lại bước tái hiện cụ thể hơn (build lúc nào, xem ở đâu).

- nút xem trang cần nằm cạnh fit của preview (enable/disabel không ẩn), trang nào Save mà chưa build thì có dáu tròn màu vàng, file đang sửa chưa save thì có dấu màu xanh lá, (các nút thông báo nằm sat bên phải) Khi nhấn build page mà các file liên quan chưa lưu thì tự động lưu theo
  - ✅ Đã sửa trong `src/pages/PageEditor.tsx`: nút "Open in new tab" chuyển xuống cạnh nút Fit trong toolbar preview, luôn hiển thị nhưng disable khi không phải page.tsx (thay vì ẩn). Sidebar file tree (`ComponentTreePanel.tsx`) giờ có 2 chấm tròn sát bên phải tên file: xanh lá khi đang sửa chưa lưu, vàng khi đã Save nhưng chưa Build lại. Build/Build all giờ tự động lưu mọi file chưa lưu trước khi build thay vì bị disable.

- nút build all nằm sat bên phải - bên trái hiện chữ Page Builder
  - ✅ Đã sửa: topbar giờ hiện "Page Builder" bên trái, nút Build all nằm sát bên phải (cùng pattern `.topbar-page-title` các trang khác đã dùng).

- chỗ hiện problems resize đang bị ngược di chuyển xuống thì chạy lên
  - ✅ Đã sửa: `useResizablePanel` có thêm option `invert`, áp dụng cho panel Problems (handle nằm trên panel, không phải trước nó như sidebar/preview) nên kéo xuống giờ đúng chiều thay vì bị ngược.
