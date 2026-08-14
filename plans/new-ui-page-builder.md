Xây dụng UI Page Builder: tôi cần thêm chế độ hiển thị để tốt hơn cho trang page editer
- page editer vẫn giữ lại như một cơ chế tuỳ chọn cho người dùng chuyên nghiệp (hoặc sẽ xoá sau nếu cần vì vi phạm DRY)
- trang riêng hoàn toàn tách biệt nhưng cũng cơ chế hoạt động chỉ khác UI với page editer
- trang /dry/page-builder?path=...
- Nguyên trang là iframe chiếm 100% screen của brower có cùng chức năng với preview 
- có 1 nút foat ở dưới bên phải giống vị trí và UI của VEI - tên là Toolbar
- Menu page:
    - hiện popup bong bóng bên trái là các tab: page, component, style, md tương ứng
    - ở page khi nhấn vào sẽ đi đến trang preview đó - có thể mở kéo thả panel bên phải (giống VEI), mở ra để edit code
    - ở các file khác, nhấn vào sẽ mở dialog lg 1 hoặc 2 page (có preview hay không) để hiện code và chỉnh sửa code trên đây, có nút save, reset đầy đủ
    - tại trang preview này menu toolbar có thể bật tắt chế độ VEI (không giống 100% chỉ tương đồng một vài chức năng):
        - bật sẽ hiện các cái đánh mấu của data-dry (thêm css và js tương ứng cho phần này vào trang)
        - khi click vào thì thay cho code editer sẽ hiện ra trang edit entry/singleton tương ứng
        - edit entry/sington hoặc code thì preview sẽ đổi theo
    
