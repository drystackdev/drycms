# Content type = 1 file JSON trong git (bỏ bảng `metadata`)

## Plan

### Quyết định đã chốt với user (2026-08-21)

1. **Content type không còn là bảng dữ liệu.** Bảng `metadata` (D1 + sqlite)
   bị bỏ hẳn; toàn bộ định nghĩa content type sống trong **một file JSON duy
   nhất**.
2. **File JSON là source of truth**, git là nơi lưu lịch sử/ghi. D1 chỉ còn
   giữ *bảng dữ liệu thật* (entries) - không giữ một dòng schema nào.
3. **Draft (thay đổi chưa apply) nằm trong chính file đó**, không còn
   IndexedDB (`content-type-draft-db.ts`) và không còn KV staging
   (`ai-content-type-drafts.ts`).
4. Đường dẫn: **`content/types.json`** - gộp per-type mirror cũ
   (`content/types/<id>.json`) thành một file. Mirror entries
   (`content/entries/**`) giữ nguyên như hôm nay.
5. Draft ghi vào **working copy trong browser** (ZenFS, giống file code), chỉ
   **commit + push khi bấm "Apply and build"**.
6. Baseline để tính migration diff nằm **trong chính file JSON**
   (`{ applied, drafts }`) - user chấp nhận rủi ro "sửa tay/revert file trong
   git ⇒ baseline lệch với bảng thật".

### Hình dạng file (`content/types.json`)

```jsonc
{
  "format": 1,           // version của định dạng file này
  "revision": 42,        // tăng mỗi lần apply - thay cho `_versions` row của "__content-types__"
  "applied": [ /* ContentTypeDefinition[] - đúng với bảng thật trong D1 */ ],
  "drafts": [ { "definition": {...}, "isNew": true, "source": "local" | "ai" } ]
}
```

- `applied` = baseline migration (thay `oldAllTypes` đọc từ `metadata`).
- `drafts` = đúng nội dung `draft-store.ts` đang giữ trong IndexedDB hôm nay.
- File nằm ở **cùng một đường dẫn** trong 2 nơi: repo git (`content/types.json`)
  và `pagesSourceStorage` (`.dry/pages-source/content/types.json` local, R2 ở
  prod) - bản trong storage là bản server đọc ở runtime (hot path), bản trong
  git là bản có lịch sử. Apply chạy server-side (ghi storage + DDL trong một
  bước), browser commit đúng nội dung server trả về.

### Giai đoạn

- **G1 - Server core**: `schema-document.ts` (pure: parse/serialize/merge
  seed/draft ops) + `schema-file-store.ts` (đọc/ghi qua `StorageAdapter`,
  bootstrap seed, import một lần từ bảng `metadata` cũ nếu file chưa có).
  `migration.ts` bỏ `metadataStatement`; `seed.ts` tách DDL/data-seed ra khỏi
  metadata insert; `engine/sqlite.ts` + `engine/d1.ts` chỉ còn chạy DDL và
  đọc/ghi doc. `getResourceVersion` lấy từ `revision` của doc.
- **G2 - Routes**: `routes/content-types.ts` (dry-run/apply/delete) chạy trên
  doc; route mới đọc/ghi doc cho client; MCP `propose_content_type` ghi thẳng
  `drafts` vào doc; xoá `ai-content-type-drafts.ts` + KV staging.
- **G3 - Client**: `draft-store.ts` đọc/ghi doc (git working copy khi có git,
  storage API khi không); xoá `content-type-draft-db.ts`;
  `BuilderContentType.tsx` / `ContentTypeEditor.tsx` / `ApplyBuildDialog.tsx` /
  AI wizard chuyển sang seam mới.
- **G4 - Git**: cho phép `content/types.json` qua path allowlist của
  `pages-source/commit`; commit+push sau khi apply thành công; bỏ mirror
  per-type; `content-history.ts` + `ContentHistoryDialog.tsx` trỏ vào file
  duy nhất.
- **G5 - Dọn + test**: `backup.ts` / `full-reset.ts` / `fresh-boot-dump` bỏ
  `metadata`; cập nhật unit test + e2e + docs.

## Status

**G1 + G2 + G3 xong, test/typecheck sạch (1474/1474).** Đã đổi so với kế
hoạch ban đầu 1 điểm (xem "Sai lệch có chủ ý" bên dưới).

Server:
- `content-types/schema-document.ts` (mới, thuần): định dạng
  `{format, revision, applied, drafts}`, parse nghiêm (file hỏng/format mới
  thì THROW chứ không trả schema rỗng), serialize sort theo `name` cho diff
  git sạch, các phép `withAppliedType`/`withoutAppliedType`/`withDraft`/
  `withoutDraft` (apply mới bump `revision`, lưu draft thì không).
- `engine/schema-document-store.ts` (mới): interface `SchemaDocumentStore`
  + bản in-memory cho test; `server/schema-document-storage.ts` (mới) là bản
  thật, đọc/ghi `content/types.json` qua `pagesSourceStorage`.
- `engine/sqlite.ts` + `engine/d1.ts`: KHÔNG còn tạo/đọc/ghi bảng `metadata`.
  `listContentTypes`/`getContentType` đọc doc; `applySave` chạy DDL trước rồi
  mới ghi doc (bảng là nửa không rollback được, nên doc chỉ tiến tới schema
  mà DB đã thật sự có); `deleteContentType` drop bảng rồi ghi doc;
  `getResourceVersion()` = `revision` của doc (`_versions` vẫn được mirror
  cho thứ gì còn đọc bảng đó).
- **Import 1 lần từ project cũ**: nếu chưa có file mà DB còn bảng `metadata`
  thì đọc bảng đó ra doc rồi thôi (không ghi lại bảng bao giờ nữa). Đã chạy
  thật trên `.dry/` của máy này: `.dry/pages-source/content/types.json` giờ
  có đủ 11 type import từ bảng cũ.
- `migration.ts`: `MigrationPlan.metadataStatement` -> `nextDefinition`;
  `seed.ts`: `pendingSeedStatements` -> `pendingSeed` trả `{statements,
  definitions}`.
- `routes/content-type-drafts.ts` (mới): `GET`/`PUT` cho nửa `drafts` của
  file (không bao giờ đụng `applied`), gate `content-types:setting`.
- `content-types-git-commit.ts` (mới): sau khi apply/delete THÀNH CÔNG,
  chính SERVER commit `content/types.json` (`[CONTENT] ...`) qua
  `commitContentChanges` - best-effort, chưa cấu hình repo/token hỏng/host
  `custom` thì trả `{committed:false, reason}` chứ không làm hỏng apply.
  `routes/content-types.ts` trả thêm `git` trong response của apply.
- `routes/content-history.ts`: bỏ nhánh POST `kind:"schema"`, `?schema=` giờ
  trỏ vào `content/types.json` (lịch sử schema = lịch sử 1 file).
- `routes/full-reset.ts`: ghi lại doc bằng seed mới sau khi restore dump.
- `routes/backup.ts`: dump `.sql` mang theo doc ở dòng marker
  `-- drycms:content-types {...}`; restore ghi doc lại sau khi restore bảng.
  Backup cũ (không có marker) restore vẫn chạy, doc giữ nguyên.

Client:
- `draft-store.ts`: giữ nguyên API (`drafts`/`saveDraft`/`discardDraft(s)`/
  `getDraft`/AI sync), nhưng backend giờ là `GET/PUT /api/content-type-drafts`
  + BroadcastChannel cho cross-tab; ghi được xếp hàng (một chuỗi promise) nên
  2 edit nhanh không đảo thứ tự. `content-type-draft-db.ts` (IndexedDB) đã
  XOÁ, `FullResetDialog` bỏ DB đó khỏi danh sách xoá.
- `ApplyBuildDialog.tsx` / `ContentTypeEditor.tsx`: bỏ
  `syncSchemaChangesToGit` (đã xoá khỏi `entry-git-sync.ts`), apply xong là
  discard draft luôn; nếu server báo commit lỗi (khác "not-configured") thì
  toast cảnh báo.

Test mới: `schema-document.test.ts` (6), `engine/sqlite.test.ts` +2 (persist
qua 2 adapter, import `metadata` cũ), `routes/content-type-drafts.test.ts`
(3, gồm cả apply xoá draft khỏi file). ~25 file test cũ phải thêm
`pagesSourceStorage` vào mock config + dùng chung doc store thật.

### Sai lệch có chủ ý so với kế hoạch

Draft **không** ghi vào working copy git trong browser (kế hoạch ban đầu là
vậy). Lý do phát hiện khi làm: `POST /api/pages-source/commit`
(`commitWorkingCopy` mà Page Builder dùng) validate path bằng
`isPageSourcePath` - `content/types.json` nằm ngoài 4 root nên MỌI commit của
Page Builder sẽ fail ngay khi file đó dirty trong working copy. Thay vào đó:
draft nằm ở bản storage của cùng file đó (server), và server commit đúng file
đó khi "Apply and build" - vẫn đúng yêu cầu "draft vào git khi apply", không
làm hỏng commit code.

### Còn lại

- MCP `propose_content_type` vẫn staging ở KV (`ai-content-type-drafts.ts`);
  proposal chỉ vào file khi browser đồng bộ nó thành draft. Gộp hẳn vào file
  là việc riêng, chưa làm.
- Chưa test bằng UI thật (dev server đang chạy phải restart mới thấy route
  mới - HMR không nhận entry mới trong `API_ROUTES`), và chưa test commit git
  thật vì tài khoản dev trong memory đã stale.
- Repo cũ vẫn còn `content/types/<id>.json` từ mirror per-type ngày trước -
  không tự dọn.

## Speed

Chưa có blocker. Lưu ý: cây làm việc đang có thay đổi chưa commit của việc
khác (custom git provider) - không đụng vào.
