# Build components

- Trang Custom component hiện tại chỉ là nơi code tạm cần được thay đổi, cơ chế khác
- Trang hiện tại cứ để qua 1 bên trươc

# Trang Component builder

- Có 2 Panel 
- panel 1: 2 row 1 để 
    + preview (tận dụng lại hiện thêm width height) 
    + config name, desritop, ...
- panel 2: là UI dạng Tabs có 2 tab
    + 1 tab là props builder để tạo ra props dùng cho tab2 (nếu children có thì sẽ là monacal html)
    + 2 tab để nhập props với tên type là Props và nhận code TSX
