# hiện tại ở richtext đang dùng ProseMirror để quản lý drap drop

- nhược điểm lệ thuộc vào cây ProseMirror không thể tụ do dùng cơ chế sort 
- các UI khó thêm hiệu ứng vì phải dự vào ProseMirror
- Cần bỏ cơ chế này mà có giải pháp khác

# Giải pháp

- khi bật reorder app sẽ chuyển qua 1 chế độ khác dùng html thuẩn chỉ để thực hiện drapdrop
- Tận dụng cơ chế Nested Sortables của thư viện `SortableJS` mã nguồn mở để hỗ trợ drap drop block và container

# Cách này tại sao hay?

- tối ưu hiệu ứng
- tách biệt công việc

# style

- không dùng màu primary cho hightline gì cả, chỉ dùng các màu backgroun accent card hover...
- có Animation khi chuyển đổi đẹp, có thể dùng hiện ứng transition nếu cần

# clear

- xoá code cũ vì chuyển qua loigc mới

# vận hành

- chuyển đổi đoạn html mà Editer cho trình drap drop
- drap drop mô phỏng lại với thay đổi style ít chỉ thêm một chút padding margin (hiện tại quá nhiều - kiến user quá khó hình dung)
- khi tắt reover html truyền vào editer để tiếp tục cộng việc
- vẫn làm việt trong shadow root