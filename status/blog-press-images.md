# Ảnh cho bài viết (blog) và bài báo (press mention)

## Plan

Thêm chỗ chọn ảnh trong admin cho hai chỗ trên site công khai đang là ô xám
cứng (`bg-slate-200`):

1. `blog` (collection) - thêm field `image` ("Cover Image"), render ở 4 chỗ:
   card "Bài viết mới nhất" trên Home, card ở `/blogs`, ảnh lớn đầu trang chi
   tiết, và card "Bài viết liên quan".
2. `pressMention` (component, dùng chung bởi singleton `homepage` và
   `about`) - thêm field `image` ("Image"), render ở ô 48x48 của card "Bài
   báo nói về tôi" trên cả hai trang.

Cả hai field đều **optional**: entry chưa chọn ảnh vẫn render đúng ô xám như
trước, không có entry cũ nào hỏng vì thiếu ảnh.

## Status

Xong.

- `scripts/seed-pages-content.ts`: thêm hai field vào định nghĩa `blog` và
  `pressMention` (nguồn schema chuẩn cho môi trường mới). Dữ liệu seed không
  đổi - ảnh để trống, admin tự chọn.
- DB dev đang chạy (`.dry/content.sqlite`) **không** được migrate bằng
  `bun run seed:pages` - script đó `clearCollection("blog")` + ghi đè lại
  copy của các singleton, mà schema/dữ liệu thật đã lệch khỏi script (ví dụ
  `blog.content` đang là `layoutContent: true`, `about.seo_metaTitle` là bản
  override viết tay). Thay vào đó chạy một script một lần: đọc định nghĩa
  thật từ DB → chèn field `image` → `planSave`/`applySave` qua đúng engine
  API. Kết quả: `blog` v9, `pressMention` v9; cột `image` xuất hiện ở
  `blog`, `homepage_pressMentions`, `about_pressMentions`. Không đụng entry
  nào.
- `bun run dry:generate` → `Blog.image?: string`, `PressMention.image?:
  string`.
- Trang: `src/apps/pages/page.tsx`, `blogs/page.tsx`,
  `blogs/[slug]/page.tsx`, `about/page.tsx` - mỗi chỗ là một ternary
  `image ? <img src={imageSrc(...)}> : <div class="...bg-slate-200">`, giữ
  nguyên kích thước/bo góc cũ, `alt` lấy từ `title`/`outlet`.

## Speed

Một lượt, không blocker.

QA đã chạy:

- `bun run typecheck`, `bun run test` (87 file / 894 test) - pass.
- Gán tạm ảnh vào DB rồi `curl` cả 5 vị trí render (Home card, Home press,
  `/blogs`, chi tiết, related, About press) - đúng `<img src="/dry/api/
  storage/...">` với đúng class; sau đó đã trả dữ liệu về `NULL` như cũ.
- Playwright trên dev server thật: editor `blog` hiện "Cover Image" +
  nút "Choose image"; dialog "Add Press Mentions" hiện field "Image" +
  "Choose image". List page của Blog Post cũng có thêm cột "Cover Image".
