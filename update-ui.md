# Chỉnh sửa UI

- sau khi thực hiện thì dùng playwrite test

## tại trang http://localhost:4321/dry/content-types/6471bf9a-b608-45db-83ce-2dd7e0875c71/edit, http://localhost:4321/dry/content-types/new/collection

- chia nhỏ UI thành các Component để dễ bảo trì
- Viết SlugField giống TextField nhưng có onChange={} trả ra (value, slug) => void *Tận dụng các chức năng cần thiết bên dưới* ui gồm 2 input (layout stack - ở input thứ 2 có nút icon <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
	<path d="M0 0h24v24H0z" fill="none" />
	<path fill="currentColor" fill-rule="evenodd" d="m18.94 6.5l-2.97-2.97l1.06-1.06l3.897 3.896a1.25 1.25 0 0 1 0 1.768L17.03 12.03l-1.06-1.06L18.94 8H5.75c-.69 0-1.25.56-1.25 1.25V11H3V9.25A2.75 2.75 0 0 1 5.75 6.5zm-13.88 11l2.97 2.97l-1.06 1.06l-3.897-3.896a1.25 1.25 0 0 1 0-1.768L6.97 11.97l1.06 1.06L5.06 16h13.19c.69 0 1.25-.56 1.25-1.25V13H21v1.75a2.75 2.75 0 0 1-2.75 2.75z" clip-rule="evenodd" />
</svg>
) ở bên phải chung row giống UI của keystatic - desctiop nằm dưới input thứ 2

- Thêm các mô tả cho các chức năng các khu vực
- Bỏ Technical name: tự động lấy slug của Title (cho phép chỉnh sửa, nằm cạnh Title)
- Fields Item cần hiển thị nhiều thông tin hơn (desciption, validate, require), Fields Sytem và customfield hiẹn chung 1 list
- field sytem không có nút deleted và không thể click để sửa
- Các Component Field ui cần thêm required (hiện dấu * đỏ)
- button remove field sẽ hiện dialog confirm

- valiation - thêm chỗ nhập default value:
    - text thêm chỗ nhập regex, chọn format, nhập min - các ô này tương tác với nhau disabled enabled cho phù hợp (tuỳ bạn quyết định) - Required là của validaton nhung ui tận dụng - min != null, regex cũng là required
    - Number: mặc định step = 1

- Features ghi rõ chức năng từng cái là gì - ghi cho người không biết kĩ thuật hiểu
    - thêm chức năng timestampe (created_at, updated_at)
    - Title không phải trường mặc định mà chỉ đi chung với chức năng `slug`
    - ID mới là trường mặc định (không cho drap drop)

- Dialog edit/add field
    - thêm Description, name là slug của Label (có thể đổi hoặc đồng bộ tự động khi nhập)
    - chi làm 2 cột ở desktop cột bên trái hiện Label, slug, description, type, default
    - cột 2 chỉ là khung tróng đến khi người dùng chọn type

- button save đổi thành save & apply schema (hiện dialog confirm cho edit mode)

- ở drop and drop trong hệ thống hiện tại dùng một phần thư viện SortableJS (chỉ copy những code cần thiết trong (Sortable-master) để vào src/lib/dnd)

## tại http://localhost:4321/dry/content-types/
- thêm icon cho các mục sinh động hơn
- các mục là menu bên trái (1/4)
- bên phải (3/4) là table hiện danh sách (có mô tả từng danh mục)
- mặc định menu mở collection