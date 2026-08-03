# Tôi đang có ý tưởng phát triển Custom Component trực tiết trên cms chat với tôi để tìm ra giải pháp đúng nhé

**Không liên quan đến component của richtext**

# Cơ chế hoạt động

- có CodeField nhập code tsx -> build trực tiếp ở brower (không VITE, không server node) mọi import giữ nguyên chỉ build phần tsx (<div style={{...}}>) thành code preact
- yêu cầu dùng thư viện `sucrase` để handle trên server
- preact đã có sẵn để chạy preact 

# ở trang /build-componet 

- có 2 tabs
+ tab1: có preview (Tận dụng lại cái đã có)
+ tab2: có CodeField chuyển đổi code trực tiếp 

# Đây chỉ là demo ban đầu

- Yêu cầu Build được component
- Chạy được trên brower
- preview luôn nằm trong shadow root để tách biệt css
