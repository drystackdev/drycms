# Bối cảnh

- Cơ chế cũ dùng trực tiếp cây ProseMirror để quản lý drag/drop.
- Nhược điểm là UI kéo-thả phụ thuộc vào decoration và cấu trúc ProseMirror, khó tạo nested sortable và hiệu ứng ổn định.

# Giải pháp

- khi bật reorder app sẽ chuyển qua 1 chế độ khác dùng HTML thuần chỉ để thực hiện drag/drop
- tự viết một controller nested-sortable nhẹ, không phụ thuộc SortableJS hay thư viện kéo-thả khác

# Cách này tại sao hay?

- tối ưu hiệu ứng
- tách biệt công việc

# style

- không dùng màu primary cho hightline gì cả, chỉ dùng các màu backgroun accent card hover...
- có Animation khi chuyển đổi đẹp, có thể dùng hiện ứng transition nếu cần

# Quy tắc HTML đã chốt

- `p`, `h1`…`h6` chỉ nhận phrasing content; không nhận block lồng bên trong.
- `ul`/`ol` chỉ nhận `li`; block kéo vào list sẽ được bọc thành `li`, `li` kéo ra list sẽ được unwrap.
- `li` là flow container có thể kéo cả item; table, figure và list lồng trong `li` được phép.
- `blockquote` là flow container; có handle neo bên trái.
- `table` di chuyển như một block atomic; table không được đặt trực tiếp trong `p`/heading.
- `tr` có thể kéo trong cùng `thead`/`tbody`/`tfoot`, với handle neo ở ô đầu tiên; không tự ý phá `rowspan`/`colspan`.
- `td`/`th` là container cấu trúc, không phải block kéo độc lập; nhận flow content và table lồng, nhưng không nhận `tr`/cell trực tiếp.
- `figure` là block atomic có thể di chuyển như `p`, không phải drop target; nội dung ảnh/figcaption không kéo ra/vào.
- grid item và cell chỉ nhận đúng loại nội dung theo schema hiện tại.

# Trạng thái triển khai

- Đã có HTML reorder surface trong Shadow Root, placeholder/overlay/hover target và nested drop.
- Handle được dùng cho container dễ thao tác; drop-only container (`td`/`th`, table section, caption, figcaption…) không thêm handle riêng.
- Khi tắt reorder, HTML đã làm sạch metadata/UI kéo-thả rồi được parse lại vào ProseMirror.
- Logic kéo-thả/decorations cũ trong ProseMirror đã được xoá; plugin chỉ còn giữ cờ bật/tắt để khoá editor và điều khiển HTML surface.

# vận hành

- chuyển đổi đoạn html mà Editer cho trình drap drop
- drap drop mô phỏng lại với thay đổi style ít chỉ thêm một chút padding margin (hiện tại quá nhiều - kiến user quá khó hình dung)
- khi tắt reover html truyền vào editer để tiếp tục cộng việc
- vẫn làm việt trong shadow root
