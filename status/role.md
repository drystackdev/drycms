Tôi cần lên kế hoạch thực hiện trang quản lý role - api dùng chung với các api content khác - học hỏi cái hay role permission của Strapi

[] Cập nhật permission tự động khi create, delete matadata
  - mỗi collection đều tạo 5 quyền: View, Create, Update, Delete, Publish (enable nếu collection có dùng)
  - mỗi singleton đều tạo 1 quyền: Setting
[] Khi Tạo 1 singleton luon có 1 row đầu tiên
[] Trang hiển Thị danh sách Role như những trang khác - click vào row sẽ edit
[] edit entry đổi có UI khác biệt
  - hiện thông tin như tên role, description
  - hiện chỗ chọn User cho role này
  - Danh sách Permision dưới dạng list có collapse để mở ra bên trong có 5 quyền: View, Create, Update, Delete, Publish (nếu view không bật thì tất cả quyền đều không được bật) dùng Checkbox role="switch" nhé
  - ở Item permission xem có hiện 5 chấm nhỏ tương ứng 5 quyền - cái nào được bật thì có màu green
  - khi có chọn quyền hoạch thay đổi quyền thì có nút save
  


**Singleton** khi được tạo từ singleton tự động tạo 1 row tương ứng
**trang content type** nhập các field có ô nhập default để hiện default lên UI hoặc tạo sãng cho singtone default nàm cột bên trái
**permission cho singlrton** chỉ tạo 1 permission thay vì tạo 4