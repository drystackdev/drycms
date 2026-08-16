# Git làm nguồn code duy nhất cho page-source (isomorphic-git + ZenFS trong Page Builder)

## Plan

### Mục tiêu (chốt với user 2026-08-16)

1. Page Builder quản lý source bằng **git thật chạy trong browser**
   (`isomorphic-git` + `ZenFS` backend IndexedDB) - working copy nằm trong
   browser, không còn đọc/ghi qua `/api/pages-source` mỗi lần save.
2. **Git là nguồn GHI duy nhất** của page-source. R2 `pagesSourceStorage`
   tụt xuống vai trò **mirror derived** (server tự sync sau mỗi push), không
   ai được ghi thẳng vào nữa.
3. **Commit lên `main` -> tự động build + publish** đúng những file đã sửa
   (chạy trong tab admin ngay sau khi push - xem "Ràng buộc kỹ thuật" #1).
4. **PAT là bắt buộc**: chưa cấu hình repo/branch/PAT hợp lệ thì Page Builder
   không hoạt động (hard-fail có hướng dẫn), không còn best-effort như
   GitHub Sync hiện tại.
5. Vào admin là **clone/fetch ngay**, để Build/Publish dùng được liền.

Quyết định user đã chốt:

- PAT giữ **server-side** (tái dùng singleton `githubSync` đã mã hoá), đi qua
  **git proxy same-origin**; browser không bao giờ thấy PAT.
- Auto-build chạy **trong tab admin ngay sau push**, không dựng CI.
- Dev local: `.dry/pages-source` thành clone git thật, Page Builder save thì
  **mirror xuống đĩa** (dev-only) để Vite HMR/live preview/dev SSR giữ nguyên.
- **PageEditor (`/dry/page-editor`) và PageBuild (`/dry/page-build`) sẽ bị xoá**
  sau khi Page Builder hoàn thiện -> không tốn công migrate 2 trang đó, chỉ
  giữ chúng chạy tạm trên R2 mirror cho tới lúc xoá.

### Ràng buộc kỹ thuật đã xác minh trong repo

1. **Server không build được.** Pipeline build là browser-only:
   `page-components/page-build.ts` dùng `evalModule` (`new Function`, workerd
   chặn cứng - xem `status/... vei-client-render`) và `tailwind-build.ts`
   compile Tailwind trong **iframe thật** (`document.createElement("iframe")`,
   `@tailwindcss/browser`). Nên "auto deploy khi commit" chỉ có thể xảy ra
   trong một tab admin đang mở. Hệ quả phải chấp nhận: commit từ VS Code /
   MCP / GitHub web **không** lên live ngay - nó được build bù ở lần vào admin
   kế tiếp (cơ chế `lastBuiltCommit` ở Giai đoạn 4).
2. **github.com không trả CORS header cho git smart-HTTP** -> bắt buộc có
   proxy. Ta tự làm proxy same-origin thay vì dùng `cors.isomorphic-git.org`:
   vừa tránh bên thứ ba, vừa là chỗ tiêm PAT server-side.
3. Đã có sẵn để tái dùng, **không viết lại**:
   - `src/server/github-source-sync.ts` - Git Data API (blob/tree/commit/ref),
     `ensureBranchExists` (tạo commit đầu từ `mock/` khi branch trống),
     `pullPagesSourceSnapshot` (đọc cây tại 1 sha).
   - Singleton `githubSync` (`system-github-sync`: enabled/repo/branch/token
     `secretkey`) + `GithubSyncSettings.tsx` + `decryptSecret`.
   - `initial-publish.ts` (`publishPagesAffectedBySource`) - đã có sẵn logic
     "chỉ publish page nào có dependency closure chạm vào file đã đổi".
   - `page-build.ts` (`pagesAffectedBy`, `computeSourceHash`, `canSkipBuild`,
     `resolveAllPageTargets`, `publishBuiltPages`).
4. Các surface còn đọc/ghi page-source qua R2 (giữ chạy nhờ mirror ở Giai
   đoạn 5, chuyển sang commit ở Giai đoạn 6): MCP `write_page_source`, Magic
   Chat `kind:code`, `vei-live-refresh.ts` (VEI trên site public), dev SSR
   `DevPagesSource`, `ensurePagesSourceSeeded`, sitemap dev.

### Giai đoạn 0 - Spike (bắt buộc làm trước, ~0.5 ngày)

Mục đích: giết rủi ro lớn nhất trước khi đụng vào Page Builder.

- Dựng trang throwaway (hoặc script Playwright) làm đúng chuỗi:
  `clone(depth:1, singleBranch)` -> sửa file -> `add`/`commit` -> `push`
  qua proxy, trên một repo thật.
- Xác minh cụ thể:
  - **Push từ shallow clone** có bị GitHub từ chối không (nếu có: fallback
    `depth: 50`, hoặc clone full - cây source chỉ là text, rất nhẹ).
  - Proxy trên Worker stream được `git-upload-pack`/`git-receive-pack`
    (POST body binary, response chunked) - không buffer cả body vào memory.
  - Kích thước bundle thật của `isomorphic-git` + `@zenfs/core` + `@zenfs/dom`
    (dynamic import, không vào bundle chính) và dung lượng IndexedDB sau clone.
- Đầu ra: ghi kết quả vào chính file này; nếu push shallow fail -> chốt
  chiến lược clone trước khi đi tiếp.

### Giai đoạn 1 - Config + git proxy (server)

- `githubSync` từ "tuỳ chọn" thành **bắt buộc**:
  - Khi lưu Settings: validate thật (`GET /user`, `GET /repos/{repo}` ->
    kiểm tra `permissions.push`), báo lỗi inline trên field (đúng rule
    "inline field validation, not toast"), không chỉ lưu mù.
  - Bỏ ý nghĩa `enabled` kiểu bật/tắt best-effort: có config hợp lệ = bật.
- Route mới `src/server/routes/git-proxy.ts`:
  - `GET|POST {path}/api/git/*` -> forward tới
    `https://github.com/<repo>.git/<...>` kèm `Authorization` từ PAT giải mã.
  - **Allowlist cứng** đúng 3 endpoint: `info/refs?service=git-upload-pack|
    git-receive-pack`, `git-upload-pack`, `git-receive-pack`. Repo/branch lấy
    từ config server, **không** nhận từ client (chống SSRF).
  - Stream cả 2 chiều, giữ nguyên `Content-Type`/`Content-Encoding`, dùng
    `fetchNoRedirect`, không forward cookie của admin ra ngoài.
  - Gate quyền `PAGE_BUILDER_RESOURCE_ID` trong `handler.ts` (cùng nhóm
    `pages-build`/`dry-http`), qua `rate-limit.ts`.
  - Chưa cấu hình PAT -> `412` kèm message actionable (client render thành
    màn hình "Cấu hình GitHub" thay vì Page Builder).
- Test: allowlist path/method, thiếu config, thiếu quyền, không rò PAT ra
  response header.

### Giai đoạn 2 - Working copy trong browser

- Deps mới: `isomorphic-git`, `@zenfs/core`, `@zenfs/dom` (tất cả **dynamic
  import**, cùng kỷ luật `import("./page-build.js")` đang dùng).
- `src/page-components/git/`:
  - `git-fs.ts` - mount ZenFS IndexedDB tại `/repo`, một instance duy nhất.
  - `git-repo.ts` - `ensureCloned()`, `fetchAndFastForward()`, `statusMatrix`
    -> dirty list, `commitAll(message)`, `push()`, `log()`, `readAllSource()`
    (đọc 4 root `pages/ component/ styles/ md/` thành `Record<path, content>`
    - đúng shape `sourceByPath` mà `page-build.ts` đang nhận).
  - `url` của isomorphic-git trỏ thẳng `{path}/api/git` (same-origin), không
    cần `corsProxy`, không cần `onAuth`.
  - **Web Locks** quanh mọi thao tác ghi: 2 tab admin cùng mở là chuyện bình
    thường, ZenFS/IndexedDB không tự chống được ghi song song.
- Boot: `AuthenticatedApp` (`routers/App.tsx`) gọi `ensureRepoReady()` ngay
  sau khi auth xong, cạnh chỗ `needsInitialPublish` hiện tại - lần đầu là
  clone, các lần sau chỉ `fetch` + fast-forward. Trạng thái (`cloning` /
  `ahead N` / `behind N` / `dirty`) đẩy vào một signal dùng chung để Page
  Builder và topbar cùng đọc.
- Repo/branch trống -> gọi `ensureBranchExists` (server, đã có) để tạo commit
  đầu từ `mock/` rồi mới clone.

### Giai đoạn 3 - Page Builder chuyển sang ZenFS

- `use-page-builder-source.ts`: thay `loadAllPagesSource()` (HTTP) bằng
  `readAllSource()` (ZenFS); `save(path)` ghi file vào working copy
  (+ ở dev thì PUT thêm xuống `/api/pages-source` để HMR/live preview không
  đổi hành vi); `dirtyPaths` lấy từ `git.statusMatrix` thay vì Set local.
  Bỏ hẳn header `X-Dry-Base-Source-Hash` (optimistic concurrency của HTTP) -
  git lo việc đó.
  Lợi phụ: edit chưa commit **sống sót qua reload** (hiện tại mất - đúng món
  nợ kỹ thuật ghi trong doc comment của hook).
- Toolbar: thêm luồng **Commit & Deploy** - liệt kê file thay đổi, nhập
  message, `commit` -> `push` -> build (Giai đoạn 4). Trạng thái ahead/behind
  hiển thị ngay trên toolbar.
- **Xung đột**: push bị từ chối (non-fast-forward) -> `fetch`, hiện danh sách
  file phân kỳ, cho chọn theo từng file "lấy bản remote" / "giữ bản của tôi".
  V1 **không** tự merge 3 chiều.
- History: `git.log()` từ working copy thay cho `listSnapshotCommits` (gọi
  GitHub API); "Restore commit" = `git.checkout` file tại sha đó.

### Giai đoạn 4 - Auto build + publish sau push

- Diff `oldHead..newHead` (`git.walk`) -> `changedPaths`.
- Refactor `initial-publish.ts`: `publishPages()` nhận **source loader tiêm
  vào** thay vì gọi cứng `loadAllPagesSource` -> dùng lại nguyên vẹn cho cả
  đường ZenFS (không tải lại source qua HTTP nữa) lẫn đường cũ.
- Sau push thành công: `publishPagesAffectedBySource(changedPaths)` -> ghi
  `built/live/*` như hiện tại (đây chính là "deploy"). Kết quả báo theo đúng
  quy ước đang có: thành công = toast sống sót reload, thất bại = panel
  "Problems".
- Lưu `lastBuiltCommit` (per branch) vào system settings/KV. Lúc boot, sau
  `fetch`: `HEAD !== lastBuiltCommit` -> tự build phần diff. Đây là cách các
  commit từ VS Code/MCP/GitHub web được bù build.

### Giai đoạn 5 - R2 thành mirror chỉ-đọc

- Sau push, browser gọi `POST {path}/api/pages-source/sync-from-git {sha}`;
  server đọc các blob đã đổi qua GitHub API (tái dùng
  `pullPagesSourceSnapshot`) và ghi vào R2, xoá path đã bị remove.
- Nhờ vậy MCP / Magic Chat / VEI public / dev SSR / sitemap **không phải sửa
  gì** trong giai đoạn chuyển tiếp.
- `/api/pages-source` `PUT`/`PATCH`/`DELETE` chỉ còn dành cho mirror writer và
  dev bridge; khoá hẳn ở Giai đoạn 7 khi PageEditor/PageBuild bị xoá.

### Giai đoạn 6 - Ghi từ MCP/AI cũng thành commit

- MCP `write_page_source` và Magic Chat `kind:code` chuyển sang commit
  server-side qua Git Data API (gộp nhiều file của cùng một turn thành **1
  commit**), rồi mirror ngay xuống R2.
- Sau đó chúng không còn ghi thẳng R2 -> hết nguy cơ mirror ghi đè mất bài
  của AI.

### Giai đoạn 7 - Dọn dẹp

- Xoá `/dry/page-editor` + `/dry/page-build` và các phần chỉ phục vụ chúng
  (`page-source-cache-db.ts`, `page-source-draft-db.ts`, hook GitHub-sync
  trong build flow, `pages-source-github-sync.ts` POST/`pages-source-github-
  restore.ts` nếu History đã chuyển sang `git.log`).
- `/api/pages-source` thành read-only trên production.
- Cập nhật `CLAUDE.md`/`AGENTS.md` ("Page source lives only in
  `pagesSourceStorage`" -> "sống trong git, R2 chỉ là mirror"),
  `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`.

### Rủi ro / điểm phải canh

1. Push từ shallow clone bị từ chối -> Giai đoạn 0 phải trả lời trước.
2. Proxy git trên Worker: streaming, `Transfer-Encoding`, giới hạn CPU; hành
   vi `wrangler dev` có thể khác production - phải QA trên deploy thật.
3. Quota IndexedDB + 2 tab admin ghi song song -> Web Locks + thông báo rõ.
4. "Auto deploy" phụ thuộc tab admin đang mở (đã chấp nhận). Nếu sau này
   thấy đau, phương án dự phòng là GitHub Actions chạy Playwright headless mở
   `/dry/page-build?autoBuild=1` - dùng lại đúng pipeline browser, không viết
   lại build cho Node.
5. PAT một tài khoản dùng chung -> commit không phân biệt được ai sửa. Nếu
   cần attribution, thêm sau: `author` của commit lấy theo user đang đăng
   nhập, còn PAT vẫn là của hệ thống (git tách author/committer sẵn).
6. Giai đoạn 5-6 là cửa sổ có 2 đường ghi (PageEditor cũ vs git). Bounded vì
   mirror chỉ ghi đè file có trong commit, nhưng phải xoá 2 trang cũ sớm.

### Ước lượng

G0 0.5đ · G1 1đ · G2 1.5đ · G3 1.5đ · G4 1đ · G5 1đ · G6 1đ · G7 0.5đ
-> khoảng **8 ngày công**, có thể ship dần theo giai đoạn (sau G4 là đã dùng
được thật).

## Status

Chưa bắt đầu code - mới chốt xong plan + 4 quyết định kiến trúc với user
(2026-08-16). Việc kế tiếp: Giai đoạn 0 (spike clone/commit/push qua proxy).

## Speed

Chưa có blocker. Cần user cung cấp repo + PAT thật để chạy spike G0.
