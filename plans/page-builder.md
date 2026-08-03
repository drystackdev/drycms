# Xây dụng page builder

- hiện tại chỉ làm việc với DEV sau này sẽ làm việc được với production

# cơ trang quản lý router

/
/about
/contact
/blog
- có children /[slug] or /[...slug]

# xây dụng dựa trên compnent preact

- các trang sẽ được build thành các trang html tĩnh kết hợp với file .js đi kèm đẻ dùng cơ chế hydate

# các trang sẽ hoạt động như sau
- lưu file vào src/pages - mỗi thư mục chứa 
+ layout.tsx chứa file layout luôn có children để import vào tự động - layout sẽ lòng nhau dựa trên đường dẫn
+ page.tsx chứa file nội dung luông là con của layout (layout .... layout  > page)
- các file đều có hàm async vì sẽ chạy ở server lần đầu có thể gọi API

# giao diện 
- path: /page-builder - khi vào trang này tự động thêm thu nhỉ menu (.collapsed dùng signal để quản lý chung) 
- bên trái sẽ là navbar quản lý role như tree của menu nav chính (collapse menu) nhưng nhỏ hơn chỉ hiện các page
- 
