> **Đã gộp vào [`app-r2.md`](./app-r2.md)** (giai đoạn 6 + các mục 1/5/6/8/9/13
> ở đó). File này giữ lại nguyên văn ý tưởng gốc, không còn là plan để làm
> theo - sửa `app-r2.md` chứ đừng sửa file này.

# Xây dụng page builder

- cơ chế ở MVP1 là dạng edit code ở tại trang admin
- có bên trái là cây thư mục tham chiếu cho /src/apps/**/**
- tát cả các file trong src/apps/ là lưu trong R2

# Khi build sẽ có cơ chế build riêng cho từng file

- Khi thay đổi 1 file .tsx, 1 singletone hay 1 entry collection sẽ build lại trang kèm tailwincss riêng cho từng trang (không build dư)

# tỏng quan

- drycms bản chat là server file nhỏ các dịch vụ xây quay xây dụng ra file html js css, phục vụ một số chức năng thực sự cần thiết ví dụ như schudule (cơ chế riêng)
- môi trang build sẽ build luôn 1 đoạn xml riêng khi gọi sitemap.xml sẽ lấy all về và build thành xml chung cho goole
