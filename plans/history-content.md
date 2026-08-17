# Bối cảnh

- hiện tại data đang lưu toàn bộ trong D1
- Chưa có cách nào lấy lịch sử dữ liệu về máy khi đã chỉnh sửa entry, singleton, content type

# kì vọng

- có hệ thống quản lý version của text dựa trên cơ chế của git đang có trong hệ thống hiện tại

# ý tưởng

- khi save 1 data vào D1, sqlite thì sẽ lưu json vào git với cấu trúc git theo dạng `thư mục` <=> `table`, `file json` <=> `raw dữ liệu`
- khi tôi save lên D1 reponse cần trả về ngay giá trị trang web nhận dữ liệu và trở về ngay -> khi đã nhận dữ liệu xong thì code cũng được đưa lên git (commit + push tự động)
- database đống vai trò xử lý search và hiện dữ liệu nhanh nhất có thể, git giữ vai trò version
- ở mỗi trang edit entry (kể cả VEI) thì vẫn có nút xem version cho từng file hiện dialog
- nút History ở dock chia làm 2 tab code, content dựa trên commit để lọc với `[CODE] ...` và `[CONTENT] ...`
