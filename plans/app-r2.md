- Các trang chính là nằm trong src/apps/pages

Nghiên cứu ý tưởng trên production
- các file .tsx sẽ lưu trong R2 thành file txt
- Khi clint gọi "/about" lấ file "/about/page.tsx", "/about/layout.tsx", "/layout.tsx" + dữ liệu trong reader (dry)

# người dung có thể đổi code trực tiếp trên brower và lưu lại
- có thể lưu file .js vì brower đã có sẵn có chế chuyển tsx thành file .js (<div> -> h("div"))
- 1 thư mục tên src/**/**.tsx song song với pages/**/**.js
- server dùng render html string 

# cơ chế client (admin mode)

- khi người dùng chỉnh sửa 1 trang vd /about/page.tsx thì sẽ build lại các trang liên quan bằng brower, sau đó lưu vào R2
- khi có data D1 thay đổi cũng build lại trang phụ thuộc

kết quả là server sẽ có cache tương ứng chỉ có HTML, js server không cần ssr