# Key Value system

## Plan

- Rà soát kiến trúc hiện tại và các adapter liên quan.
- Viết kế hoạch chi tiết cho core memory store, persistence coordinator, sáu adapter, lifecycle và kiểm thử.
- Chưa triển khai mã nguồn; file này là status tracking cho giai đoạn lập kế hoạch.

## Status

- Đã đọc `docs/README.md`, `docs/ARCHITECTURE.md` và `docs/CODING-PRINCIPLES.md`.
- Đã kiểm tra storage factory, config resolution, SQLite driver, D1 driver và Fetch-shaped server context.
- Đã viết kế hoạch tại `docs/key-value-plan.md`.
- Đã cập nhật quyết định branch: không dùng `GITHUB_BRANCH`/`GITLAB_BRANCH`;
  branch mặc định theo subsystem (`storage`, `icons`, `content`, `richtext`).
- Đã triển khai `branch?: string` cho các file-backed config hiện tại và cập
  nhật resolver theo thứ tự config → tên subsystem.
- Đã sửa GitHub/GitLab auto-create branch để branch mới bắt đầu với tree rỗng,
  không kế thừa dữ liệu từ branch chính.
- Đã thêm test cho branch cấu hình thắng branch từ environment.
- Đã cập nhật `.env.example` và tài liệu kiến trúc, bỏ branch dùng chung khỏi
  danh sách environment.
- Các thay đổi đang có trước task trong `src/pages/ContentTypeEditor.tsx` và `src/pages/content-type-editor/FieldsList.tsx` được giữ nguyên.

## Speed

- Hoàn thành phần khảo sát và lập kế hoạch trong một lượt.
- `bun run typecheck` pass.
- `src/storage/github.test.ts` và `src/storage/gitlab.test.ts`: 68/68 pass.
- Các test branch của `options.test.ts`: pass. Ba test cũ kiểm tra env bị thiếu
  vẫn bị ảnh hưởng bởi credential GitHub có sẵn trong `.env` local, vì resolver
  hiện chủ động đọc `.env` khi process env không có giá trị.
