# Key Value system

## Plan

- Rà soát kiến trúc hiện tại và các adapter liên quan.
- Viết kế hoạch chi tiết cho core memory store, persistence coordinator, sáu adapter, lifecycle và kiểm thử.
- Chưa triển khai mã nguồn; file này là status tracking cho giai đoạn lập kế hoạch.

## Status

- Đã đọc `docs/README.md`, `docs/ARCHITECTURE.md` và `docs/CODING-PRINCIPLES.md`.
- Đã kiểm tra storage factory, config resolution, SQLite driver, D1 driver và Fetch-shaped server context.
- Đã viết kế hoạch tại `docs/key-value-plan.md`.
- Đã bổ sung yêu cầu `branch` cho các config GitHub/GitLab: ưu tiên config,
  fallback về env (`GITHUB_BRANCH`/`GITLAB_BRANCH`), rồi mặc định `main`.
- Đã triển khai `branch?: string` cho các file-backed config hiện tại và cập
  nhật resolver theo thứ tự ưu tiên config → env → `main`.
- Đã thêm test cho branch cấu hình thắng branch từ environment.
- Các thay đổi đang có trước task trong `src/pages/ContentTypeEditor.tsx` và `src/pages/content-type-editor/FieldsList.tsx` được giữ nguyên.

## Speed

- Hoàn thành phần khảo sát và lập kế hoạch trong một lượt.
- `bun run typecheck` pass. Toàn bộ `options.test.ts` trong workspace hiện bị
  ảnh hưởng bởi các biến GitHub có sẵn trong `.env`; các test branch mới chạy
  pass khi lọc riêng.
