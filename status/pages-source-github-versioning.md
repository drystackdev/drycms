# Pages-source GitHub versioning (snapshot-on-build)

## Plan

Bối cảnh: `pagesSourceStorage` (local hoặc R2 tuỳ `kind`) vẫn là nơi
đọc/ghi SỐNG như hiện tại (`page-editor` save, VEI, dev server đọc trực
tiếp) - không đổi gì ở đây. Yêu cầu mới: coi local/R2 chỉ là bản "tạm",
mỗi lần **build** (Build current / Build all, ở cả `PageEditor.tsx` và
`PageBuild.tsx`) thì đẩy thêm 1 **snapshot commit** của toàn bộ cây
`pages-source` lên một repo GitHub - đó mới là nơi giữ phiên bản lâu dài.
Đã từng có `kind: "github"/"gitlab"` cho `StorageAdapter` (dùng cho
Media/Icons + `content.engine: "file"`) nhưng đã gỡ (`883eff2`) - lần này
không tái dùng làm ĐƯỜNG ĐỌC/GHI SỐNG (rate-limit, latency, cần `sha`
đúng mới PUT được, phá luôn model `DevPagesSource` đọc file local mỗi
request), mà chỉ dùng GitHub API cho một hành động rời rạc, best-effort,
kích hoạt bởi build.

1. **Config: singleton hệ thống `githubSync`** (theo đúng pattern
   `googleVerification`/`seoDefaults` - xem `google-verification-singleton.md`)
   - `system-fields.ts`: thêm `GITHUB_SYNC_TYPE_ID = "system-github-sync"`.
   - `seed.ts`: singleton `hidden: true, locked: true`, fields:
     - `enabled` (boolean/toggle, default false) - tắt hẳn tính năng khi
       chưa cấu hình, để build vẫn chạy bình thường không lỗi/không log ồn.
     - `repo` (text, placeholder `your-org/your-site`, required khi enabled).
     - `branch` (text, placeholder `main`, default `"main"`).
     - `token` (type `secretkey` - cùng field type `aiKey`/`user.password`
       đang dùng, unmasked multiline, không hiện trong List theo rule sẵn có).
   - Thêm vào `NO_MAGIC_TYPE_NAMES` trong `permissions.ts` (credentials,
     không phải prose - giống `aiKey`/`googleVerification`).
   - Migrate DB live bằng script throwaway (`planSave`/`applySave`, backup
     `.dry/content.sqlite` trước - đúng quy trình `google-verification-singleton.md`
     đã dùng), rồi `bun run dry:generate`.

2. **`src/server/github-source-sync.ts`** - orchestration thuần, mock được
   `fetch` để test:
   - `pushPagesSourceSnapshot(sourceByPath: Record<string,string>, config: {repo,branch,token}, message: string): Promise<{pushed:true; commitSha:string} | {pushed:false; reason:string}>`.
   - Dùng Git Data API (KHÔNG dùng Contents API PUT-từng-file, vì "Build
     all" cần đúng 1 commit atomic, không phải N commit rời rạc):
     1. `GET /repos/{repo}/git/ref/heads/{branch}` -> base commit sha
        (repo/branch trống -> tạo ref mới từ commit rỗng, xử lý riêng).
     2. `GET /repos/{repo}/git/commits/{sha}` -> base tree sha.
     3. `POST /repos/{repo}/git/blobs` cho từng file trong `sourceByPath`
        (content-addressed - file trùng nội dung với lần trước thì GitHub
        tự dedupe, không cần tự diff ở client).
     4. `POST /repos/{repo}/git/trees` với `base_tree` = tree ở bước 2 +
        entries mới (path, mode `100644`, type `blob`, sha từ bước 3).
     5. `POST /repos/{repo}/git/commits` (message, parent = base commit,
        tree = tree mới).
     6. `PATCH /repos/{repo}/git/refs/heads/{branch}` -> trỏ sang commit mới.
   - Mọi lỗi HTTP (401/404/409...) trả về `{pushed:false, reason}` thay vì
     throw - caller quyết định có toast hay không, không bao giờ được làm
     hỏng luồng publish chính (best-effort, giống cách `dry.generated.d.ts`
     fetch trong `PageEditor.tsx` đang "never fatal").

3. **Route mới `src/server/routes/pages-source-github-sync.ts`**
   - `POST {path}/api/pages-source/github-sync`, gate quyền như
     `CODE_EDITOR_RESOURCE_ID`/`SYSTEM_BUILD_RESOURCE_ID` (setting action).
   - Đọc singleton `githubSync` qua content-types engine hiện có; nếu
     `!enabled` -> trả `{ pushed: false, reason: "not-configured" }` ngay,
     không gọi GitHub.
   - Đọc TOÀN BỘ cây `pagesSourceStorage` server-side (đã có sẵn qua
     `pagesSourceStorage` trong `server/config.ts` - không cần round-trip
     HTTP tới chính route `pages-source.ts` như client đang làm qua
     `createPagesSourceApi`).
   - Gọi `pushPagesSourceSnapshot`, trả JSON kết quả.

4. **Hook vào build flow** (client, best-effort):
   - `PageEditor.tsx`: cuối `handleBuildCurrent`/`handleBuildAll` (sau
     `publishBuiltPage(s)` thành công), gọi endpoint trên trong `try/catch`
     riêng; lỗi chỉ toast `type:"default"` cảnh báo ngắn ("Build xong
     nhưng chưa đồng bộ GitHub: <lý do>"), KHÔNG đổi trạng thái
     success/failure của toast build chính đã có.
   - `PageBuild.tsx`: tương tự ở đúng chỗ "Build all" (resumable queue) kết
     thúc - gọi 1 LẦN sau khi cả queue xong, không gọi mỗi batch (mỗi
     commit GitHub nên là 1 snapshot trọn vẹn, không phải N commit dở dang
     giữa chừng nếu queue bị gián đoạn/resume).
   - `message` truyền vào: `"Build: <pathname hoặc "N pages"> - <ISO timestamp>"`.

5. **Settings UI** - thêm sub-item "GitHub Sync" vào nhóm "Settings"
   (`DryLayout.tsx`, cùng `ContentNavGroup` đã tổng quát hoá cho
   `googleVerification`), route `/dry/settings/github-sync`, form nhỏ
   giống `AiKeyEditor.tsx` (enabled toggle, repo, branch, token
   `SecretKeyField`) thay vì đi qua generic content-entry editor.

6. **Test**
   - `github-source-sync.test.ts`: mock `fetch`, verify đúng thứ tự 6
     bước gọi API, đúng payload blob/tree/commit, xử lý ref chưa tồn tại
     (repo trống), và mọi nhánh lỗi trả `{pushed:false}` chứ không throw.
   - `routes/pages-source-github-sync.test.ts`: not-configured -> no-op;
     configured + mocked sync thành công -> trả commitSha.

## Status

Hoàn thành cả 6 bước + migrate DB live, chưa QA bằng UI thật (chưa có
GitHub token thật để thử end-to-end).

1. Singleton `githubSync` (id `system-github-sync`) - `system-fields.ts`,
   `seed.ts`, `NO_MAGIC_TYPE_NAMES` trong `permissions.ts`. Migrate DB live
   qua `POST /api/content-types` thật (backup `.dry/content.sqlite` trước),
   `bun run dry:generate` lại.
2. `src/server/github-source-sync.ts` - `pushPagesSourceSnapshot`, Git Data
   API (blob->tree->commit->ref), xử lý cả 3 case: branch có sẵn, branch
   mới (fallback default branch), repo hoàn toàn trống (root commit).
   `GithubApiError` riêng mang status để phân biệt "404 = chưa có ref" với
   lỗi thật (network/401/...) - ban đầu bug: catch nuốt luôn lỗi mạng, test
   phát hiện ra, đã sửa.
3. `src/server/routes/pages-source-github-sync.ts` (`POST /api/github-sync`)
   - đọc singleton + giải mã token qua `decryptSecret`, đọc toàn bộ
   `pagesSourceStorage` qua `getStorageAdapter` (fallback đệ quy `list()`
   cho R2 vì `listAll` chỉ có ở local), gọi `pushPagesSourceSnapshot`. Gate
   quyền `SYSTEM_BUILD_RESOURCE_ID` trong `handler.ts`, cùng nhóm với
   `dry-http`/`pages-build`.
4. Hook: `PageEditor.tsx` (`reportGithubSync` sau `handleBuildCurrent`/
   `handleBuildAll`), `PageBuild.tsx` (sau `runBuildQueue` xong TOÀN BỘ
   queue, không phải mỗi batch) - qua `page-components/github-sync-http-api.ts`
   dùng chung. **Không** hook vào `buildOne`/nút Build từng dòng hay
   `autoBuild` (VEI headless rebuild sau khi lưu content) - đó là rebuild do
   CONTENT đổi, không phải CODE đổi, snapshot lại y hệt cây nguồn mỗi lần
   save entry sẽ chỉ tốn API call vô ích.
5. `GithubSyncSettings.tsx` (enabled/repo/branch/token, secretkey giữ
   "blank = keep existing" như `AiKeyEditor.tsx`) + `DryLayout.tsx` nav +
   `App.tsx` route `/dry/settings/github-sync`.
6. `github-source-sync.test.ts` - 6 test (mock `fetch`, không gọi GitHub
   thật): rỗng, happy path branch có sẵn, fallback default branch, repo
   trống (root commit), lỗi API không throw, lỗi network không throw.
   `bun run typecheck` sạch (trừ 1 lỗi có sẵn, không liên quan, trong
   `src/apps/pages/` - thư mục build artifact bị gitignore). `bun run test`
   toàn repo: đúng 14 test fail PRE-EXISTING (xác nhận bằng `git stash` so
   sánh trước/sau) - đều liên quan `googleVerification` (tính năng trước,
   không phải của session này), không cái nào liên quan `githubSync`.

Chưa làm: test cho route `pages-source-github-sync.ts` (route test cần
dựng `DryRouteContext`/adapter mock khá tốn, đã ưu tiên test phần logic
Git Data API thuần trước vì đó là phần dễ sai nhất).

## Speed

Xong trong 1 phiên. Việc chưa làm duy nhất là QA thật với 1 GitHub repo +
token thật (cần user cung cấp) và route-level test.
