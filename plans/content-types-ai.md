
# Cơ chế Content type được AI hỗ trợ build

- ở trang `http://localhost:5173/dry/content-types` sẵn có thêm nút AI genration là một card có mô tả
- Thêm .border-magic là border cho các công cụ AI có nhiều màu chuyển đổi ở border animation

# AI key sẽ lấy từ bảng AI key 

- AI keys thêm ô để nhập model
- Test AI keys (chỉnh UI cho ScreetKeyField để nhận action? này) - khi nhấn thì test thử xem AI có chạy được không?
- *DEV* sử dụng các API cli local như `claude -p --strean-json` hoăcj `codex ` cái nào còn hạng thì tự động dùng - confi ở dry.config.ts

# cơ chế database 

- có nút để đánh Index cho Field nếu cần chung với unique - index thêm vào db thật khi dùng engine 'sqlite' | 'D1'

# Cách Hoạt động

- Khi nhất vào nút AI Content type builder mở dialog
- dialog sẽ hiện ra bảng hỏi từ AI, AI sẽ hỏi người dùng để thu thập dữ liệu có thể tạo thêm - không đủ thông tin sẽ hỏi tiếp để chọn bắt đàu sẽ có ô nhập, cập nhật collection đang có (không xoá, không đụng đến nhắc đến role, permision) - 
- AI giao tiếp với người dùng bằng ngôn ngữ trong dryconfig {AI: {lang: "vi" | "en"}}
- trong lúc tạo có view console hiển thị cho người dùng xem AI nghĩ gì trên dialog câu trả lời nếu cần sẽ nằm ở dưới đây, nếu nhiều câu hỏi thì phân tab, trả lời hết thì cho submit - có thêm nút AI tự quyết định (tuỳ câu hỏi)
- AI đóng vai chuyên gia top 1 tối ưu cấu trúc của AI

# Giúp tôi phát triển ý tương này lên