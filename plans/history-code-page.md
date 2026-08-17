# Cơ chế lưu lịch sử thay đổi trên github

- hiện tại các file code đã lưu toàn bộ lên github
- chưa thể xem hoặc trở lại phiên bản trước đó của code

# Cơ chế

*History từng file*
- khi mở 1 file code (page.tsx) sẽ có icon history cho tôi xem lịch sử thay đổi file trong history lg
- khi click vào thì trang sẽ tạm thời tải file đó về mấy preview, code ở dạng readonly
- tại thời điểm code readonly đó có 1 nút revert code và exit
    - revert code: ghi đè version cũ lên version cuối dùng
    - exit: thoát khỏi chế độ history code

*History all*
- có nút history trong dock
- mở dialog lg xem các lần push có thể mở ra xem bao nhiêu file đã sửa trong đó
- có nút review tạm thời lấy toàn bộ code ở commit đó về zenfs, chỉ readonly để preview code, khi vào chế độ review các file code không có các nút chức năng nào, có nút revert code và exit ở dock

**Yêu cầu**
- khi tạo hệ thống

# ghi chú
- khi vào chế độ read history thì cần có 1 border cho toàn bộ trang border màu primary 2px solid để người dùng biết đang xem history

## xem sét cơ chế và gợi ý cho tôi nếu logic tôi đang đặc ra có vấn đề hoặc không phù họp UX