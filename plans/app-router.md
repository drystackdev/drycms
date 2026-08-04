# Xây dụng App router là tham chiếu page như NextJS

- thư mục chủ đích là src/apps/pages
- tên thư mục ứng với tên của path
- trong thư mục có các file
    - layout.tsx: luôn gọi lòng nhau
    - page.tsx: chứa code hiện ra page
- file có thể là [..path] hoặc [slug]/page.tsx để nhận được slug từ Dry.params (Dry là object tự tạo để trả các biến)
- các file chạy ở server nên có là sync functions
- khi viết xong sẽ build thành file .html, .js (dùng hydrate tải lazy về sau để tái tạo app react), file .css dùng chung
- hệ thống dùng tailwindcss v4 cho riêng thư mục src/apps


# đây là ý tưởng cần được phat triển tiếp