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
- **PageEditor (`/dry/page-editor`) sẽ bị xoá** sau khi Page Builder hoàn
  thiện -> không tốn công migrate. ĐÃ XONG 2026-08-17
  (`status/page-builder-only-surface.md`): Page Editor + VEI public đều đã
  xoá, Page Builder là surface sửa code duy nhất, mọi thao tác file đã đi qua
  MỘT seam `use-page-builder-source.ts`. `/dry/page-build` (Build all) giữ
  lại.

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

---

## Kế hoạch thực hiện (2026-08-17)

Sau khi Phần 1 xong (`status/page-builder-only-surface.md`), đây là thứ tự
làm CỤ THỂ. Mỗi gói ghi rõ: file đụng tới, cách kiểm chứng, và có cần PAT
thật hay không.

### Ràng buộc mới xác minh trong repo (ảnh hưởng trực tiếp tới G1)

- `request-limits.ts`: `maxBodyBytesFor` mặc định **2 MiB** cho mọi segment
  chưa liệt kê -> `git-receive-pack` (push) sẽ bị 413 ngay. **Bắt buộc** thêm
  nhánh `if (segment === "git") return MAX_GIT_BODY_BYTES` (đề xuất 50 MiB,
  bằng `MAX_UPLOAD_BODY_BYTES`).
- `limitRequestBody` đã bọc body bằng `ReadableStream` + `duplex: "half"` ->
  proxy **stream được**, không phải buffer. Chuyển thẳng
  `context.request.body` sang `fetch` upstream.
- CSRF: `lib/native/csrf-fetch.ts` patch `window.fetch` toàn cục cho
  `/dry/api/*` và tự thêm `X-CSRF-Token` cho POST -> isomorphic-git dùng
  `http/web` (fetch, body là `Uint8Array` đã gom sẵn, KHÔNG stream) nên
  **được CSRF miễn phí**, không cần đụng `csrf.ts`.
- Gate quyền: thêm `if (segment === "git")` cạnh khối `pages-source` trong
  `handler.ts` (`requirePermission(context, PAGE_BUILDER_RESOURCE_ID,
  "setting")`).
- `fetchNoRedirect` ném lỗi khi upstream 3xx. GitHub 301 khi repo bị đổi
  tên/chuyển chủ -> lỗi sẽ hiện ra là "refused to follow a redirect"; message
  của proxy phải nói rõ "repo có thể đã đổi tên" thay vì để nguyên.
- Phiên bản package (đã tra registry): `isomorphic-git@1.41.4` (~4.9 MB
  unpacked), `@zenfs/core@2.6.3`, `@zenfs/dom@1.2.10`.

### Gói 1 - G0a: spike CLONE, **không cần PAT** (làm trước tiên)

Clone ẩn danh một repo GitHub **public** qua proxy của chính mình trả lời
được 3/4 câu hỏi rủi ro mà không cần credential nào:

1. `src/server/routes/git.ts` bản tối thiểu: allowlist đúng 3 endpoint
   (`info/refs?service=git-upload-pack|git-receive-pack`, `git-upload-pack`,
   `git-receive-pack`), repo lấy từ config server, stream 2 chiều, chưa cần
   token.
2. Spec Playwright throwaway (`e2e/tmp-git-spike.spec.ts`, xoá sau) mở một
   trang admin, dynamic-import `isomorphic-git` + ZenFS, `clone({ depth: 1,
   singleBranch: true, url: "/dry/api/git" })`.
3. Đo: thời gian clone, dung lượng IndexedDB (`navigator.storage.estimate()`),
   kích thước chunk mà Vite build ra cho 3 package đó.

Kết quả ghi vào mục Status của file này. Nếu ZenFS/IndexedDB hoặc bundle
không ổn -> đổi hướng (ví dụ `LightningFS`) TRƯỚC khi viết tiếp.

### Gói 2 - G1: config + proxy hoàn chỉnh (không cần PAT để viết + test)

- `content-types/seed.ts`: `githubSync` giữ nguyên field, chỉ đổi mô tả
  `enabled` (giờ nghĩa là "bật git working copy"), + migrate DB live bằng
  script throwaway như `google-verification-singleton.md` đã làm.
- `GithubSyncSettings.tsx`: validate thật khi Save (`GET /user`,
  `GET /repos/{repo}` -> `permissions.push`), lỗi hiện **inline trên field**
  (rule sẵn có), không toast.
- `src/server/routes/git.ts` hoàn chỉnh: đọc + `decryptSecret` token, chèn
  `Authorization`, chặn mọi path ngoài allowlist, không forward cookie admin
  ra ngoài, 412 + message actionable khi chưa cấu hình.
- `request-limits.ts` + `handler.ts` như mục ràng buộc ở trên.
- Test (mock `fetch`, không gọi mạng): `routes/git.test.ts` - allowlist
  path/method, thiếu config -> 412, thiếu quyền -> 403, token không lọt vào
  response header, body vượt hạn -> 413.

### Gói 3 - G0b: spike PUSH (**cần repo + PAT thật**)

Trên repo do user cấp: clone `depth:1` -> sửa 1 file -> `commit` -> `push`.
Câu hỏi phải trả lời: GitHub có nhận push từ shallow clone không. Nếu không:
fallback `depth: 50`, rồi full clone (cây source toàn text, rất nhẹ).

### Gói 4 - G2: working copy trong browser

- `src/page-components/git/git-fs.ts` (mount ZenFS IndexedDB tại `/repo`, một
  instance duy nhất, **Web Locks** quanh mọi thao tác ghi).
- `src/page-components/git/git-repo.ts`: `ensureCloned` / `fetchAndFastForward`
  / `statusMatrix` / `commitAll` / `push` / `log` / `readAllSource`
  (trả đúng `Record<path, content>` shape mà `page-build.ts` đang nhận).
- Tất cả **dynamic import** (kỷ luật `import("./page-build.js")` đang dùng).
- `routers/App.tsx`: `AuthenticatedApp` gọi `ensureRepoReady()` ngay sau auth,
  cạnh `needsInitialPublish`; trạng thái (cloning/ahead/behind/dirty) vào một
  signal dùng chung.
- Repo/branch trống -> gọi `ensureBranchExists` (đã có) tạo commit đầu từ
  `mock/`.
- Test: unit cho `readAllSource`/`statusMatrix` mapping (mock fs), e2e cho
  luồng clone lúc đăng nhập.

### Gói 5 - G3: Page Builder đọc/ghi ZenFS

Đây là chỗ Phần 1 đã dọn sẵn: chỉ sửa **một** file,
`use-page-builder-source.ts` (`loadAllPagesSource` -> `readAllSource`;
`save`/`createFile`/`renameFile`/`deleteFile` -> ghi ZenFS; `dirtyPaths` ->
`git.statusMatrix`), cộng luồng **Commit & Deploy** trong dock và dialog xử
lý xung đột khi push bị từ chối. Ở dev thêm mirror PUT xuống
`/api/pages-source` để Vite HMR không đổi hành vi.

### Gói 6 - G4: auto build + publish sau push

- Diff `oldHead..newHead` (`git.walk`) -> `changedPaths`.
- Refactor `initial-publish.ts` để `publishPages` nhận **source loader tiêm
  vào** (hết đọc lại qua HTTP).
- `lastBuiltCommit` lưu vào system-settings/KV; lúc boot nếu `HEAD !==
  lastBuiltCommit` thì build phần diff (đây là cách commit từ VS Code/MCP
  được bù build).

### Gói 7-8 - G5, G6, dọn dẹp

Như mô tả ở Giai đoạn 5/6/7 phía trên.

### Thứ tự & phụ thuộc

```
Gói 1 (G0a, không PAT) ─┬─> Gói 2 (G1) ──> Gói 4 (G2) ──> Gói 5 (G3) ──> Gói 6 (G4) ──> G5 ──> G6 ──> G7
                        └─> Gói 3 (G0b, CẦN PAT) ────────^ (chặn G3 vì push là bắt buộc để commit)
```

Có thể bắt đầu ngay Gói 1 + Gói 2 mà không cần bất cứ thứ gì từ user. Chỉ Gói
3 trở đi mới cần **repo + PAT thật** (PAT scope: `repo` cho classic, hoặc
fine-grained với quyền `Contents: Read and write` trên đúng repo đó).

## Status

**Gói 1 (G0a) + Gói 2 (G1) + Gói 3 (G0b): XONG 2026-08-17.** Mọi rủi ro kỹ
thuật của plan đã được trả lời bằng thí nghiệm thật. Việc kế tiếp là **Gói 4
(G2 - working copy trong browser, nối vào `AuthenticatedApp`)**.

### Gói 3 - G0b: spike PUSH trên repo thật (ĐẠT - câu hỏi rủi ro lớn nhất đã tắt)

Repo thật của user (`GITHUB_REPO` trong `.env`), branch `drycms`, chạy trong
Chromium qua `/dry/api/git`:

| Bước | Kết quả |
|---|---|
| Clone `depth:1` repo thật | **2583 ms**, HEAD `b80ecb4…` |
| Nội dung branch | đã có sẵn `pages/`, `component/`, `README.md` |
| Commit trong ZenFS | oid `ce02e9d…` |
| **Push từ shallow clone** | **GitHub CHẤP NHẬN** (1844 ms, `refs/heads/drycms-spike-…` ok) |
| Dọn dẹp | branch spike đã xoá qua chính proxy đó; `GET /branches` xác nhận repo còn đúng 5 branch như trước |
| Dung lượng sau clone+commit | 80 KB |

An toàn: spike KHÔNG đụng branch `drycms` - push vào một branch tạm rồi xoá,
nên lịch sử page-source thật không có commit rác nào.

**Đổi thiết kế theo cấu hình thực tế của user**: PAT được đặt trong `.env`
(`GITHUB_REPO`/`GITHUB_BRANCH`/`GITHUB_PAT_KEY`), không phải trong DB. Nên
`loadGitConfig` giờ ưu tiên **env (`context.env` cho Workers -> `process.env`/
`.env` cho Node) rồi mới tới singleton `githubSync`**. Đây là thay đổi tốt
hơn plan gốc: PAT không cần nằm trong D1, `wrangler secret put GITHUB_PAT_KEY`
là đường production, và cấu hình dùng được TRƯỚC khi có admin nào mở Settings.

### Gói 1 - G0a: spike clone qua proxy (ĐẠT)

Clone thật `octocat/Hello-World` (public, không token) qua chính
`/dry/api/git` trong Chromium, đo bằng spec Playwright throwaway (đã xoá):

| Chỉ số | Kết quả |
|---|---|
| Thời gian clone `depth:1` | **1566 ms** |
| Phase git chạy đủ | Counting → Receiving → Resolving deltas → Analyzing/Updating workdir |
| Working copy trên ZenFS/IndexedDB | `.git` + `README` đúng như repo |
| Lần gọi `ensureCloned` thứ 2 | fast-forward, KHÔNG clone lại, cùng HEAD |
| `statusMatrix` / `log` | chạy đúng (dirty rỗng, log có commit) |
| Dung lượng origin sau clone | 57 KB / quota 3.2 GB |
| Bundle `git-repo.ts` (esbuild, minify) | **565 KB raw / 170 KB gzip** - dynamic import, chỉ tải khi mở luồng git |

**3 bug/ràng buộc thật phát hiện khi spike** (đều đã sửa, ghi lại vì không
tài liệu nào nói trước):

1. **isomorphic-git đòi URL tuyệt đối** - truyền `"/dry/api/git"` thì ném
   `UrlParseError: Cannot parse remote URL`. Phải dùng
   `${window.location.origin}${adminPath}/api/git`.
2. **`Missing Buffer dependency`** - bản ESM của isomorphic-git giả định có
   global `Buffer`, chết ngay khi parse refs advertisement đầu tiên. Bản UMD
   có sẵn polyfill NHƯNG `exports` của package không expose file đó, nên
   phải thêm dependency `buffer` (~50 KB) và gán `globalThis.Buffer` một lần
   trong `git()`.
3. **Vite re-optimize giữa chừng** - 3 package này chỉ được với tới qua
   `import()` động nên Vite không thấy lúc crawl, gặp giữa phiên là
   re-optimize + **full page reload đúng lúc đang clone**. Sửa bằng
   `optimizeDeps.include` trong `vite.config.ts`. Lưu ý vận hành: lần chạy
   e2e ĐẦU TIÊN sau khi đổi danh sách `include` sẽ chậm/flaky (2 test timeout
   trong lần đó), lần sau cache ấm là 28/28 xanh trong 57s.

### Gói 2 - G1: config + proxy (XONG, trừ phần validate PAT ở Settings)

- `src/server/git-config.ts` mới: `loadGitConfig` (đọc + giải mã singleton
  `githubSync`, token có thể rỗng = repo public, chỉ đọc) + `isValidRepoSlug`.
  `loadGithubSyncConfig` cũ giờ gọi lại hàm này rồi mới bắt buộc có token.
- `src/server/routes/git.ts`: proxy git smart-HTTP. Allowlist đúng 3 endpoint,
  repo lấy từ config server (không nhận từ client), query rebuild lại từ đầu,
  chỉ forward 4 header vào và 2 header ra (**không** forward
  `content-encoding`/`content-length` - runtime đã giải nén, echo lại là
  hỏng body git đọc), không forward cookie admin, không đi theo redirect
  (301 = repo đổi tên -> message riêng), 401/403/404 có message phân biệt
  "có token nhưng bị từ chối" với "chưa có token".
- `request-limits.ts`: `MAX_GIT_BODY_BYTES = 50 MiB` cho segment `git` (mặc
  định 2 MiB sẽ 413 ngay lần push đầu).
- `handler.ts`: đăng ký `git` + gate `PAGE_BUILDER_RESOURCE_ID` chung với
  `pages-source`.
- `src/page-components/git/{git-fs,git-repo}.ts`: ZenFS mount IndexedDB +
  Web Locks; `ensureCloned`/`readAllSource`/`status`/`commitAll`/`push`/`log`/
  `changedPathsBetween`/`writeFile`/`removeFile`/`movePath`.
- Test: `routes/git.test.ts` 11 test (mock `fetch`, không chạm mạng).
  `bun run test` 1420/1420, `typecheck` sạch, `build` + `build:worker` OK,
  `test:e2e` 28/28.

**Chưa làm trong Gói 2**: validate PAT khi Save trong `GithubSyncSettings.tsx`
(`GET /user`, `permissions.push`, lỗi inline trên field). Ưu tiên thấp hơn kể
từ khi PAT đọc từ env - Settings chỉ còn là đường cấu hình phụ.

Ghi chú cũ (giữ nguyên): mới chốt xong plan + 4 quyết định kiến trúc với user
(2026-08-16). Việc kế tiếp: Giai đoạn 0 (spike clone/commit/push qua proxy).

## Speed

Chưa có blocker. Cần user cung cấp repo + PAT thật để chạy spike G0.
