## Xây dụng chức năng grid như 1 thẻ thêm vào như table ở richtext

- thẻ dùng trong hệ thống này là thẻ <div>
- code sẽ như sau (mã giả định hãy chỉnh lại cho phù hợp với thưc tế)
```html
<div class="{cid}">
    <style>/* CSS genagrate */
        .cid{display: grid;... &>*{ ... }}
        .cid>*:nth-child(1){
            grid-column: ...
            grid-row: ...
        }

    </style>
    <p></p>
    <table></table>
<div>
```
# Toolbar

- khi đang trong grid UI grid sẽ bung ra với các chức năng
    - toggle hightLine: khi bật
        - các thẻ đều có border: dashed var(--dry-border), khi hover thì đổi dashed var(--dry-text) - khi có 1 block được forcus thì thêm outlineoffet: .25rem
        - các thao khác như enter tự động thêm.. sẽ giữ nguyên
        - có 2 nút neo ở right cho thẻ đang forcus nhiện vụ là drop drop để resize column, row của thẻ đó - column của grid mặc định là 12 của row là 1 khi có thay đổi row thì row lớn nhất sẽ row của grid
    - xoá grid
- có togle move item (chức năng nằm riêng song song với button grid): 
    - khi bật thì tất cả thẻ đều không được nhập các grid có border màu primary, các block khác trong và ngoài grid đều có là dashed border
    - có thể kéo thả trong và ngoài grid di chuyển di chuyển vị trí của các block - block grid, table có ô di chuyển neo ở bên trái để di chuyển cả grid - table có thẻ di chuyển block vào từng cell
    
