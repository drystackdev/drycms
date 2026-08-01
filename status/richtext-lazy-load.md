# Plan

- Tách implementation nặng của `RichTextField` khỏi public entry point.
- Dùng `preact-iso` lazy loading để editor chunk chỉ tải khi field được render.
- Chạy typecheck, build và kiểm tra diff.

# Status

- Đã đọc tài liệu kiến trúc/design/coding principles và xác định `RichTextField.tsx` đang import trực tiếp toàn bộ editor.
- Đã tách shell/toolbar đồng bộ trong `src/components/RichTextField/field.tsx`; editor runtime được tải bằng `import()` trong effect.
- `src/components/RichTextField/editor-surface.tsx` chỉ khởi tạo ProseMirror sau khi chunk runtime tải xong.
- `bun run typecheck` thành công.
- `bun run build` thành công; output có chunk toolbar/field riêng khoảng 299 kB và editor runtime riêng khoảng 64 kB.
- Các test RichTextField pass; toàn bộ suite còn 6 lỗi pre-existing ở `options.test.ts` và `secret-crypto.test.ts`.

# Speed

- Hoàn tất implementation và regression check; không có blocker liên quan đến lazy loading.
