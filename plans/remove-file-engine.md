# Gỡ content engine `file`

`content.engine` còn 3 giá trị: `sqlite`, `D1`, `file`. Engine `file` (JSON
per-record trên storage adapter) sinh ra hồi backend còn có `github`/`gitlab` -
để sửa content bằng commit vào repo. Hai backend đó đã bị gỡ (storage giờ chỉ
còn `kind: "local"`, xem `src/server/options.test.ts:59-60`), nên `file` chỉ còn
là một engine JSON trên đĩa local: chậm hơn sqlite, thiếu tính năng hơn sqlite,
và nhân đôi mọi công việc ở tầng entry.

Quyết định: **gỡ hẳn**. Reader (`plans/reader.md`) chỉ nhắm `sqlite` + `D1`.

## Phạm vi

### Xoá

- `src/content-types/engine/file/` - toàn bộ 10 file (~130KB, gồm
  `entries-file.ts`, `file.ts`, `file-driver.ts`, `index-store.ts`,
  `migration-file.ts` + test của chúng).

### Sửa

- `src/content-types/engine/index.ts` - bỏ 2 import và 2 nhánh `case "file"`
  (dòng 4-5, 28-29, 49-50). Message lỗi `unsupported` giữ nguyên.
- `src/content-types/engine/types.ts` - bỏ import `FileSavePlan`/
  `FileDestructiveChange` (dòng 3); `AnySavePlan`/`AnyDestructiveChange` giờ
  chỉ còn một nhánh → bỏ alias, dùng thẳng `SavePlan`/`DestructiveChange` ở mọi
  call site (grep 2 tên này trước khi sửa).
- `src/content-types/draft-diff.ts` - comment ở dòng 8 và 13 đang giải thích
  hình dạng `FileDestructiveChange`; viết lại theo `DestructiveChange`. Kiểm
  tra xem shape hiện tại có phải là mẫu số chung của hai engine không - nếu có
  field chỉ tồn tại vì engine `file` (`typeName`/`fieldName`), cân nhắc bỏ.
- `src/server/options.ts`:
  - `DryContentOption.engine` (dòng 49) → `"sqlite" | "D1"`.
  - Bỏ `kind`/`root`/`branch` (dòng 66-73) và `legacyBranch`.
  - Bỏ `ResolvedFileContentOption` (dòng 200).
  - `resolveOptions`: bỏ nhánh `engine === "file"` (dòng 427-433) và check ở
    dòng 411-413; sửa message ở dòng 397-399 thành `Only "sqlite" and "D1"`.
- `src/server/options.test.ts` - cập nhật các assert trên message + xoá test của
  nhánh `file`.
- `docs/ARCHITECTURE.md` - phần mô tả 3 engine → 2.
- `status/content-type-staged-apply.md`, `status/ai-key-singleton.md` - có nhắc
  engine `file`; thêm ghi chú "đã gỡ" thay vì sửa lại lịch sử.

### Không đụng tới

- `src/storage/**` (storage adapter cho media/icons/components) - engine `file`
  *dùng* nó, không sở hữu nó.
- Mọi chỗ khác dùng chuỗi `"file"` (`FileManager.tsx`, `routes/storage.ts`,
  `mock/file-manager.ts`, ...) - đó là "file" theo nghĩa tệp tin, không liên
  quan content engine. Đừng grep-replace mù.

## Dữ liệu đang tồn tại

Không viết migration `file` → `sqlite`. Engine này chỉ dùng ở môi trường dev
nội bộ; nếu có kho JSON cần giữ thì import thủ công một lần bằng script tạm rồi
xoá script đi. **Nếu có ai đang chạy `engine: "file"` với dữ liệu thật, phải hỏi
trước khi merge.**

## Kiểm chứng

- `bun run typecheck` sạch (đây là bước bắt lỗi chính - bỏ một nhánh union sẽ
  lộ hết call site còn sót).
- `bun run test` - số test giảm đúng bằng phần đã xoá, không test nào khác đỏ.
- `bun run test:e2e` - `dry.config.ts` đang chạy `engine: "sqlite"` cho cả dev
  lẫn E2E nên phải xanh y như trước.
- Khởi động dev server, mở Content Types, tạo/sửa/xoá một entry để chắc đường
  sqlite không bị vạ lây.
