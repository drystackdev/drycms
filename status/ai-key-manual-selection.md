# AI key: bỏ tự động, người dùng chọn từ UI

## Plan

Yêu cầu: AI key không còn được chọn tự động. Người dùng chọn **API key +
model** ngay trên UI; server đọc key đó từ DB (bảng `aiKey`), gọi thẳng
provider, lỗi trả nguyên văn cho người dùng. Bỏ bước "test API key" và bỏ
vòng lặp chạy tuần tự nhiều key ở server.

### Server
1. `src/server/routes/ai.ts`
   - `readServerCredentials()` (trả mảng, sắp xếp theo `ai.keyName`, bỏ qua
     key hỏng) → `readServerCredential()` trả **đúng một** credential theo
     lựa chọn của người dùng; thiếu/không tìm thấy/model không thuộc key →
     ném lỗi rõ ràng.
   - Xoá `isAiKeyFallbackError` + `allAiKeysFailed` + vòng `for (const
     credential of credentials)` trong `createChatStream`.
   - Xoá `checkAiKey`, `CheckKeyRequest`, dispatch `POST /api/ai/check`.
     Giữ `/api/ai/models` (nạp danh sách model cho AiKeyEditor - không phải
     bước test).
   - `errorResponse` trả message thật (qua `safeAiMessage`) thay vì
     "AI provider request failed."
   - `handleWizard` / `handleRewriteSelection`: bắt buộc `aiKeyName`.
   - Route chat mặc định: nhận `aiKeyName`/`aiModel` trong body.
2. `src/server/options.ts`: xoá `ai.keyName` (chỉ tồn tại để chọn key tự động).
3. `src/server/routes/ai-magic-write.ts`: bắt buộc `aiKeyName`.

### UI
4. Component dùng chung `src/components/AiKeyPicker.tsx` (state + 2 combobox
   Key/Model), thay 2 bản sao đang có; luôn hiển thị (kể cả khi chỉ 1 key) và
   không còn tuỳ chọn "Automatic". Chưa có key nào → báo rõ + chặn chạy.
   Dùng ở: Magic Write, Ask AI (Content Types), Rewrite selection (RichText -
   trước đây không gửi key nào, sẽ hỏng nếu không thêm).
5. `AiKeyEditor.tsx`: bỏ auto-check khi thêm model (`checkKey`, `checking`,
   `checkResult`, effect debounce 400ms, dòng "Checking API key…").
6. Xoá plumbing `checkSecretKey`/`onCheck` chết trong `ContentEntryEditor.tsx`
   → `FieldRenderer.tsx` → `ScalarField.tsx` (không render gì; route
   `content/aiKey/*` đã đi qua `AiKeyEditor`).

### Kiểm tra
`bun run typecheck`, `bun run test`, chạy dev server thử Magic Write +
Ask AI + Rewrite với key thật.

## Status

- [x] Phase 1 - server (`ai.ts`, `ai-magic-write.ts`, `options.ts`)
- [x] Phase 2 - UI (`AiKeyPicker.tsx` mới + 3 nơi dùng, `AiKeyEditor` bỏ
      auto-check, dọn `checkSecretKey` chết)
- [x] Phase 3 - verify

Quyết định trong lúc làm:
- Picker **luôn hiện** (kể cả khi chỉ có 1 key) và không còn "Automatic";
  mặc định chọn cặp key/model dùng lần trước (`localStorage`
  `drycms.aiKeySelection`), nếu không có thì key đầu tiên + model đầu của
  nó. Vẫn là lựa chọn hiển thị rõ, admin đổi được trước khi chạy.
- Model trong picker = đúng các model đã lưu trên chính `aiKey` đó
  (`aiKey.model`), không gọi provider. Việc nạp model từ provider vẫn nằm ở
  trang AI Key (`/api/ai/models`, nút Refresh) - đó không phải bước test.
- Nút Rewrite selection của RichText trước đây không gửi key nào ⇒ phải
  thêm picker, nếu không tính năng này chết khi bỏ chọn tự động.
- Combobox trong picker theo layout `SelectField` (label nằm trên control,
  wrapper `.field`), 2 cột co giãn, xuống dòng khi khung hẹp.

Kiểm tra đã chạy:
- `bun run typecheck`, `bun run test` (86 files / 889 tests) - xanh.
- Dev server thật + key "Test API" (Google, gemini-3.5-flash):
  - `/api/ai/rewrite-selection` và `/api/ai/wizard` không gửi key → HTTP 400
    "Choose an AI Key before running this request."
  - model không thuộc key → `Model "gpt-4o" is not configured for AI Key
    "Test API".` trả thẳng về client.
  - happy path rewrite → stream trả về bản viết lại thật.
- Playwright trên dev server: picker hiện + chọn sẵn key/model ở Magic Write,
  Ask AI (Content Types), Rewrite selection; nút chạy bị chặn khi chưa đủ
  điều kiện; trang AI Key không còn dòng "Checking API key…"; không có lỗi
  console mới (chỉ 401 `/api/auth/refresh` sẵn có ở trang login).

## Speed

Xong trong ngày 2026-08-06.
