# Tạm ẩn các tính năng component

## Plan

- Tạm ẩn `Page Components`, `Custom Components` và `Code Editer Demo` khỏi
  sidebar.
- Tạm ẩn kind `Component` trong Content Types và nút chèn custom component
  trong RichText.
- Giữ nguyên toàn bộ route, component, API, storage và dữ liệu để phát triển
  tiếp; khi làm lại chỉ cần bật các cờ trong
  `src/features/temporary-visibility.ts`.

## Status

- Đã hoàn tất: các entry UI, tab `Component` và nút chèn RichText component
  đang bị ẩn; implementation, route, API, storage và dữ liệu vẫn giữ nguyên.
- Đã xác nhận bằng `bun run typecheck`, `bun run test` và `bun run build`.

## Speed

- Phạm vi thay đổi chỉ là visibility/UI; không xóa implementation hay
  migration/backend support. Browser tích hợp không có phiên khả dụng để chạy
  screenshot/DOM QA trong phiên này.
