# Bối cảnh

- hiện tại data đang lưu toàn bộ trong D1
- Chưa có cách nào lấy lịch sử dữ liệu về máy khi đã chỉnh sửa entry, singleton, content type

# kì vọng

- có hệ thống quản lý version của text dựa trên cơ chế của git đang có trong hệ thống hiện tại

# ý tưởng (gốc)

- khi save 1 data vào D1, sqlite thì sẽ lưu json vào git với cấu trúc git theo dạng `thư mục` <=> `table`, `file json` <=> `raw dữ liệu`
- khi tôi save lên D1 reponse cần trả về ngay giá trị trang web nhận dữ liệu và trở về ngay -> khi đã nhận dữ liệu xong thì code cũng được đưa lên git (commit + push tự động)
- database đống vai trò xử lý search và hiện dữ liệu nhanh nhất có thể, git giữ vai trò version
- ở mỗi trang edit entry (kể cả VEI) thì vẫn có nút xem version cho từng file hiện dialog
- nút History ở dock chia làm 2 tab code, content dựa trên commit để lọc với `[CODE] ...` và `[CONTENT] ...`

# Hiện trạng đã khảo sát

Hệ thống git cho **code** (pages-source) đã tồn tại đầy đủ và không dùng git
local + push như ý tưởng gốc, mà commit thẳng qua REST API:

- `src/server/github-source-sync.ts` / `gitlab-source-sync.ts` — commit qua
  Git Data API (GitHub, blob→tree→commit→ref, atomic, retry khi ref race) /
  Commits API (GitLab, `actions` array). Không có git repo local trên server.
- `src/server/git-config.ts` + singleton content type `githubSync`
  (`system-fields.ts`'s `GITHUB_SYNC_TYPE_ID`) — 1 PAT mã hoá / tenant, dùng
  chung cho mọi thao tác git.
- `src/pages/PageBuilder.tsx`'s `saveAndPublish()` — mỗi lần Save: (1) ghi
  entry draft vào D1 trực tiếp qua `/api/content`, KHÔNG có git; (2) nếu có
  sửa code, gọi `commitWorkingCopy` (browser, isomorphic-git working copy
  qua ZenFS/IndexedDB chỉ để cache) → POST `/api/pages-source/commit` → server
  commit thật qua REST API ở trên.
- `HistoryDialog.tsx` + `page-history.ts` + `history-http-api.ts` — UI xem
  lịch sử/commit đã có sẵn, nhưng chỉ scope cho pages-source, không đụng D1.
- **Content (entry/singleton/content-type schema) hoàn toàn chưa có git hay
  audit log nào** — xác nhận qua `content-entries.ts`, `content-types.ts`,
  `entries-sqlite.ts`/`entries-d1.ts`.
- Không có convention `[CODE]`/`[CONTENT]` nào trong message commit hiện tại.

# Quyết định đã chốt

1. **Cơ chế async (không cần `ctx.waitUntil`)**: D1 vẫn ghi và trả response
   ngay như hiện tại — không đụng vào `handleApiRequest`/`DryRouteContext`
   (xác nhận: `entry-worker.ts` có `ExecutionContext` ở tầng `fetch()` nhưng
   KHÔNG truyền xuống `handleApiRequest(request, env)`, và `DryRouteContext`
   chưa có field `ctx`/`waitUntil` — nếu chọn hướng đó sẽ cần thread lại toàn
   bộ, không chọn hướng này).

   Thay vào đó tận dụng draft đã có sẵn trong IndexedDB
   (`entry-draft-store.ts` / `content-types/draft-store.ts`): sau khi D1 ghi
   thành công, **không discard draft ngay** như code hiện tại đang làm
   (`ContentEntryEditor.tsx:613,617,624`, `ApplyBuildDialog.tsx:153`) — giữ
   lại, gọi API commit content lên git ở client, lỗi thì retry 3 lần, vẫn
   lỗi thì mở `ConfirmDialog` hỏi có muốn reset D1 về giá trị trước khi save
   hay không. Commit thành công mới discard draft (indicator trên nav
   dot/badge hiện có tự động biến mất).

2. **Phạm vi content type được mirror**: loại trừ các type
   system/hidden/ungrantable — `role`, `user`, `githubSync`, `aiKey`,
   `memory` — và mọi synthetic resource không có bảng thật (icon-management,
   richtext-components, system-content-types, system-build). Chỉ mirror
   content type nghiệp vụ do người dùng tạo.

3. **Field Password/SecretKey**: loại bỏ hẳn khỏi JSON commit (không xuất
   hiện key), áp dụng cho MỌI content type được mirror kể cả loại nghiệp vụ
   thường — không chỉ redact placeholder.

4. **Revert**: chỉ xem (read-only), không có nút Revert cho cả entry lẫn
   content-type schema ở bản đầu tiên — giống pattern "Review commit"/"View
   this file" hiện có cho code.

   Lưu ý: cơ chế "reset D1 về trước khi save" ở mục 1 KHÔNG mâu thuẫn với
   quyết định này — đó là undo ngay lập tức của chính lần save vừa rồi (dùng
   dữ liệu đã có sẵn trong bộ nhớ/`liveSnapshot`, không phải xem lại commit
   cũ qua History UI), không phải tính năng revert-từ-lịch-sử.

# Kiến trúc

### 1. Server — tổng quát hoá cơ chế commit cho path `content/`

- `github-source-sync.ts`'s `commitPagesSourceChanges` (dòng ~322-366) hiện
  gate cứng bằng `isPageSourcePath`/`PAGE_SOURCE_FILE_PATTERN`. Tách phần
  blob→tree→commit→ref (kể cả logic retry khi ref race) thành hàm dùng
  chung, nhận path-validator làm tham số, để file mới
  `src/server/content-source-sync.ts` gọi lại cho path `content/**.json`
  thay vì viết lại từ đầu. Áp dụng tương tự cho `gitlab-source-sync.ts`'s
  `createCommit`.
- Thêm shim dispatch content (mirror `src/server/git-source-sync.ts`, 17
  dòng) dùng lại đúng config `githubSync` singleton hiện có (`git-config.ts`)
  — không cần thêm UI cấu hình repo mới, chung repo/branch/token với code.
- Route mới `src/server/routes/content-history.ts` (mirror `page-history.ts`):
  - `POST {adminPath}/api/content-history/commit` — nhận `{contentType,
    op, id, value}`; server tự resolve `ContentTypeDefinition`, kiểm tra
    KHÔNG nằm trong danh sách loại trừ (mục 2), tự redact field
    password/secretkey (không tin client) qua helper mới
    `redactSecretFields(type, value)` (đặt cạnh `entry-draft-diff.ts`), rồi
    build message `[CONTENT] ...` và gọi hàm commit ở trên.
  - `GET {adminPath}/api/content-history` + `/commit/:sha` + `/file` — tái sử
    dụng `listSnapshotCommits`/`getCommitDetail`/`readFileAtCommit` trong
    `git-source-sync.ts` nếu đã path-agnostic; nếu đang lọc cứng theo
    `isPageSourcePath` thì nới lỏng để nhận cả path `content/`.
- Phân quyền: gate NGAY TRONG route handler (không phải một chặn segment
  chung trong `handler.ts` như `page-history` đang làm ở dòng 314-317, vì
  content-history cần biết đang xem content type nào) — dùng lại đúng
  permission `view`/`setting` của content type đó, theo đúng pattern
  `checkAccess`/`resolveType` mà `content-entries.ts` đã có. Không cần thêm
  action mới vào `PERMISSION_ACTIONS`.

### 2. Client — defer discard + retry + rollback

- Module mới `src/content-types/entry-git-sync.ts`: `syncEntryToGit(type,
  op, entry, priorSnapshot)` — POST tới endpoint commit ở trên, retry 3 lần,
  trả kết quả ok/fail.
- `ContentEntryEditor.tsx`'s `handleSave` (dòng ~583-641): sau
  `entriesApi.create/update/saveSingleton` thành công, KHÔNG gọi
  `discardEntryDraft` ngay (bỏ 3 lời gọi ở dòng 613/617/624) — gọi
  `syncEntryToGit` trước. Thành công → `discardEntryDraft` như cũ. Thất bại
  sau 3 lần retry → mở `ConfirmDialog` (component có sẵn,
  `src/components/ConfirmDialog.tsx`) hỏi reset; xác nhận thì ghi lại
  `priorSnapshot` qua `entriesApi.update` hiện có (hoặc xoá row nếu case là
  `isNew`/create), rồi mới discard draft; huỷ thì giữ nguyên draft + trạng
  thái "pending" để thử lại sau.
  - `priorSnapshot`: dùng lại `initialSnapshot`/`value` state editor đã load
    sẵn trước khi sửa — không cần fetch thêm.
- `PageBuilder.tsx`'s vòng lặp `saveDrafts` trong `saveAndPublish()` (dòng
  ~593-604, path lưu entry khi ở trong VEI/Page Builder) cần cùng xử lý defer
  + sync + rollback như trên — không chỉ standalone editor.
- Content-type schema: `ApplyBuildDialog.tsx`'s `runApply()` (dòng ~146-170)
  — sau `api.applyBatch` thành công (`succeededIds`), thay vì
  `discardDrafts(succeededIds)` ngay (dòng 153): gộp TẤT CẢ definition vừa
  apply thành công thành **một commit `[CONTENT]`** duy nhất (giống cách
  pages-source gộp nhiều file thay đổi thành 1 commit), retry 3 lần, thành
  công mới `discardDrafts`. Thất bại → dialog hỏi reset, dùng lại
  `liveSnapshot` (đã có sẵn ở dòng 119, chụp trước khi apply) để gọi lại
  `applyBatch` với definition cũ cho đúng các id vừa fail.
- Xoá entry (`ContentEntryList.tsx` delete action) / xoá content-type cũng
  cần một commit `[CONTENT]` tương ứng — xoá file JSON khỏi tree (dùng đúng
  convention `content === null` → xoá khỏi tree mà `commitPagesSourceChanges`
  đã có sẵn), không giữ tombstone.
- Nav dot/badge hiện có (`DryLayout.tsx:591,616`, ăn theo
  `entryDraftIndex`/`drafts` signal) tự động phản ánh trạng thái "đang chờ
  đồng bộ git" mà không cần thêm store/indicator mới — có thể tinh chỉnh
  thêm icon spinner sau, không bắt buộc ở bản đầu.

### 3. Cấu trúc file JSON trong git

- Entry (collection): `content/entries/<type.name>/<row-id>.json` — dùng id
  số nguyên thật của row (không phải id đã hash ở HTTP boundary,
  `src/lib/id-hash.ts`).
- Singleton: `content/entries/<type.name>/singleton.json`.
- Content-type schema: `content/types/<metadata.id>.json` — dùng `id` bất
  biến của `metadata` table, KHÔNG dùng `name` (name có thể đổi).

### 4. History UI — tab Code/Content

- `PageBuilder.tsx`'s `commitMessageFor` (dòng ~79-85): thêm tiền tố `[CODE]
  ` vào message code-commit sinh ra. Commit cũ trước tính năng này (không có
  tiền tố nào) mặc định coi là "Code" trong UI.
- `HistoryDialog.tsx` (73 dòng): thêm 2 tab bằng đúng pattern ARIA-tabs sẵn
  có (`src/lib/native/tabs.ts`, xem cách `BubbleMenu.tsx:146-159` dùng) —
  chia danh sách commit đã fetch thành Code (không có tiền tố `[CONTENT]`) /
  Content (có tiền tố) ngay ở client, không cần endpoint list riêng nếu
  `listSnapshotCommits` trả về đầy đủ lịch sử không lọc theo path.
- Entry edit page (`ContentEntryEditor.tsx:381-390` bản topbar,
  `:821-830` bản trong VEI dialog) và Content Type editor: thêm nút "Xem
  version" cạnh nút Preview sẵn có, mở `HistoryDialog` ở chế độ scoped 1
  file (dùng lại mode "View this file", KHÔNG có nút Revert theo quyết định
  #4). Icon dùng lại `HistoryIcon` có sẵn (`src/components/icons/index.tsx:609`).

# Verification (khi implement)

- Chạy dev server, sửa + lưu 1 entry: xác nhận draft trong IndexedDB (qua
  DevTools) vẫn còn tới khi commit git xong rồi mới biến mất, nav dot cũng
  vậy.
- Giả lập lỗi commit (tạm sửa sai token trong `githubSync` settings) để xác
  nhận đúng luồng retry 3 lần → `ConfirmDialog` reset D1.
- Mở History dialog, xác nhận tab Content chỉ hiện commit `[CONTENT]`, tab
  Code hiện phần còn lại (kể cả commit cũ không tiền tố).
- `bun run typecheck` sau khi code xong.
- Chưa có test tự động cho luồng git hiện tại (không tìm thấy spec nào) —
  Playwright e2e cho tính năng này là việc follow-up, không chặn bản đầu.

# Việc cần làm tiếp theo

Khi bắt đầu implement, theo dõi tiến độ trong `status/history-content.md`
(3 mục Plan/Status/Speed) theo convention của CLAUDE.md — chưa tạo, vì phần
implement chưa bắt đầu.
