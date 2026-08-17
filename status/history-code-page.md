# History code trong Page Builder (xem lịch sử + revert)

Yêu cầu gốc của user: `plans/history-code-page.md`.

## Plan

### Quyết định đã chốt với user (2026-08-17)

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Review mode nạp code vào đâu | **Chỉ trong memory.** Working copy ZenFS không bị chạm; mất khi reload là chấp nhận được. |
| 2 | History từng file hiển thị ở đâu | **Toàn trang readonly**, dùng CHUNG một review mode với History all - chỉ khác phạm vi (1 file vs cả commit). |
| 3 | Sau khi Revert | **Thành thay đổi chưa publish**, rồi mở luôn dialog Build & publish để user xác nhận. Không tự push. |
| 4 | Trang ép cấu hình GitHub | **User có quyền Page Builder: chặn cứng** vào trang setup. **User khác: không chặn**, chỉ hiện thông báo "chưa cài đặt GitHub". |
| 5 | Reset pages | Giữ đúng yêu cầu gốc: **2 commit** (xoá hết → đưa mock lên), làm bằng 1 lần `PATCH ref` (mục 1.5). |
| 6 | Conflict khi publish | **Không bao giờ hỏi conflict.** File mình publish luôn ghi đè bản trên remote; file mình KHÔNG đụng tới thì giữ bản của người kia. Không force push cả branch → không xoá commit của ai. |
| 7 | Sau khi publish xong | **Kéo toàn bộ code về ngay** (working copy reset về đúng remote) rồi reload cây trong editor. |

### 0. Ràng buộc đã xác minh trong repo (quyết định gần hết thiết kế)

| # | Sự thật trong code | Hệ quả |
|---|---|---|
| 1 | Working copy là **shallow clone** `depth: 1` (`git-repo.ts:41`, `CLONE_DEPTH`) | `git.log()` local **chỉ có đúng 1 commit** (chính HEAD). Không thể lấy lịch sử từ ZenFS. Phải đi GitHub REST API server-side, hoặc phải đào sâu clone. |
| 2 | `github-source-sync.ts` đã có sẵn: `githubRequest` (timeout 15s, `GithubApiError` mang status), `listSnapshotCommits`, `pullPagesSourceSnapshot(config, sha)` (đọc nguyên cây tại 1 sha) | Phần đọc lịch sử **gần như không phải viết mới**, chỉ mở rộng. |
| 3 | Route `github-restore` đã tồn tại + đã gate `PAGE_BUILDER_RESOURCE_ID` (`handler.ts:301`), nhưng **không UI nào gọi** (chú thích trong chính file nói vậy) | Có sẵn khuôn để nhân bản; không cần permission mới. |
| 4 | `PreviewFrame` nhận `sourceByPath` như props thuần (`PageBuilder.tsx:574`), build chạy hoàn toàn trong browser | **Preview code của một commit cũ là miễn phí** - chỉ cần truyền map khác vào. |
| 5 | `Editer` có sẵn `readOnly?: boolean` (`Editer/Editer.tsx:94`), nhưng **set-once-at-mount** | Vào/ra chế độ history phải đổi `key` để remount `Editer`. |
| 6 | Mọi thao tác ghi đi qua đúng 3 hàm trong `use-page-builder-source.ts` (`writeThrough`/`moveThrough`/`removeThrough`) | Revert chỉ cần đi qua seam sẵn có, không thêm đường ghi thứ hai. |
| 7 | `pushPagesSourceSnapshot` tạo tree **KHÔNG có `base_tree`** (`github-source-sync.ts:160`) | Một snapshot commit đã tự động xoá mọi file không có trong snapshot. Liên quan trực tiếp tới yêu cầu "Reset pages 2 commit". |
| 8 | `loadGitConfig` ưu tiên **env** (`GITHUB_REPO`/`GITHUB_BRANCH`/`GITHUB_PAT_KEY`) rồi mới tới singleton `githubSync` (`git-config.ts:46`) | Màn hình ép cấu hình phải hỏi `GET /api/git/config`, **không** hỏi singleton - nếu không, deploy cấu hình bằng env sẽ bị ép nhập lại vô lý. |
| 9 | `scripts/e2e-server.mjs` blank `GITHUB_*` → e2e chạy ở `phase: "unconfigured"` | UI history phải **ẩn sạch** khi chưa cấu hình git, nếu không 28 test e2e hiện tại gãy. |

---

### 1. Nhận xét về cơ chế user đề xuất (phần user hỏi: "logic có vấn đề không")

Tổng thể cơ chế đúng hướng. 6 điểm nên đổi:

#### 1.1 ❌ "Review mode = tải toàn bộ code của commit đó về ZenFS" - KHÔNG nên

Đây là điểm rủi ro lớn nhất trong bản mô tả. Nếu ghi cây cũ vào working copy:

- **Đè mất phần chưa publish**: user đang gõ dở (chưa Build & publish) → ghi cây cũ lên là mất, và Discard cũng không cứu được vì Discard restore từ HEAD chứ không phải từ "bản trước khi vào review".
- **Badge dock nổ**: mọi file khác HEAD → `statusMatrix` báo dirty → dock hiện N. Một cú bấm **Build & publish** nhầm trong lúc review = **publish code cũ lên site thật**. Đây là lỗi im lặng, không có gì chặn.
- **Reload/crash giữa chừng = kẹt vĩnh viễn**: working copy nằm trong IndexedDB, sống qua reload. Thoát review bằng cách "khôi phục lại" là một bước có thể thất bại; thất bại thì user không biết mình đang ở trạng thái nào.
- Ở dev còn `mirrorToDisk` → cây cũ ghi luôn xuống `.dry/pages-source`, Vite HMR render site dev bằng code cũ.

**Thay bằng**: giữ snapshot **trong memory** (`Record<path, string>` trong state của `PageBuilder.tsx`). Lý do làm được: `PreviewFrame`/`CodePanel`/`FileDialog` đều nhận source qua props (ràng buộc #4), nên chỉ cần đổi cái map truyền xuống. Working copy **không bị chạm một byte nào**. Thoát review = `setReviewCommit(null)`, không thể fail. Kích thước cây source chỉ vài chục KB nên memory không phải vấn đề.

#### 1.2 ⚠️ Revert nên là "một sửa đổi chưa publish", không phải hành động tức thì lên site

Mô tả hiện tại: "revert code: ghi đè version cũ lên version cuối dùng". Nên nói rõ ghi đè vào **đâu**.

Đề xuất: **revert = ghi nội dung cũ vào working copy qua đúng seam `updateSource`/`createFile`/`deleteFile`** → file thành "Not published" → badge dock +1 → user bấm **Build & publish** như mọi thay đổi khác.

Lợi:
- Không có đường publish thứ hai; đúng mô hình "edit là draft, chỉ Build & publish mới ra site" mà cả Page Builder đang chạy.
- Revert vẫn **undo được** bằng nút Discard sẵn có (restore từ HEAD).
- Không cần force push, không đụng vào history git (không `git revert`, không reset ref) → không bao giờ có nguy cơ mất commit của người khác.
- Ở dev vẫn mirror xuống đĩa đúng như một lần gõ tay.

Để không mất một bước bấm, sau khi revert thì **tự mở luôn dialog Build & publish** (`SavePreviewDialog`) - nó liệt kê sẵn đúng những file vừa revert.

#### 1.3 ⚠️ "Revert cả commit" phải xử lý cả file bị XOÁ, và phải confirm

"Lấy code ở commit đó về" cho *toàn bộ* commit có 3 loại thay đổi, không chỉ 1:
- file có trong snapshot, khác bản hiện tại → ghi đè;
- file có trong snapshot, **không** có hiện tại → tạo lại;
- file **không** có trong snapshot, có hiện tại (tạo sau commit đó) → **phải xoá**, nếu không kết quả không phải là "trạng thái tại commit đó" mà là một trạng thái lai chưa từng tồn tại.

Cái thứ 3 là phần dễ quên nhất và là phần phá hoại nhất → bắt buộc có `ConfirmDialog` liệt kê rõ: *"Ghi đè X file, tạo lại Y file, xoá Z file"*.

#### 1.4 ⚠️ Chặn cứng "chưa cấu hình GitHub thì không cho qua trang khác" - cần 3 lối thoát

Yêu cầu hợp lý, nhưng nếu chặn tuyệt đối sẽ khoá chết admin trong 3 tình huống thật:

1. **User không có quyền `system-build`** (biên tập viên chỉ sửa content) đăng nhập → bị đẩy vào trang cấu hình GitHub mà họ không có quyền lưu → **không dùng được CMS nữa**. → Gate chỉ áp dụng cho user `canAccess(PAGE_BUILDER_RESOURCE_ID, "setting")`; user khác đi thẳng vào dashboard.
2. **Đã cấu hình bằng env** (`GITHUB_REPO` trong `.env` / `wrangler secret`) → phải nhận ra là đã cấu hình rồi (hỏi `GET /api/git/config`, ràng buộc #8), không hỏi lại.
3. **GitHub down / token hết hạn lúc validate** → không được biến thành vòng lặp không thoát. Nút **Sign out** luôn phải bấm được trên trang setup, và lỗi validate hiện inline trên field (đúng rule "inline field validation, not toast") kèm nút thử lại.

#### 1.5 ⚠️ "Reset pages = 2 commit" - hiện tại 1 commit đã đủ, nhưng vẫn làm được sạch

Vì `pushPagesSourceSnapshot` không dùng `base_tree` (ràng buộc #7), một commit snapshot **đã** xoá mọi file không có trong mock. Nên "commit 1 xoá hết" không thêm giá trị kỹ thuật, chỉ thêm giá trị **đọc lịch sử** (một mốc "reset" rõ ràng).

Nếu vẫn muốn 2 commit thì làm đúng cách này, **không push 2 lần**:
- commit A: tree = empty tree sha `4b825dc642cb6eb9a060e54bf8d69288fbee4904`, parent = HEAD cũ;
- commit B: tree = mock, parent = commit A;
- `PATCH refs/heads/{branch}` **một lần** sang commit B.

Cả 2 commit đều vào history, nhưng branch **không bao giờ** thực sự ở trạng thái rỗng → không có cửa sổ nào mà một tab admin khác fetch về rồi build ra site trắng.

#### 1.6 ❗ Sau Reset pages, working copy trong browser phải được re-clone

Reset chạy **server-side** (REST API), còn nguồn ghi là **working copy trong browser**. Nếu không xử lý, tab admin vẫn giữ cây cũ; lần **Build & publish** kế tiếp sẽ commit đè cây cũ lên, xoá sạch kết quả reset. Bắt buộc: sau reset → xoá `/repo` trong ZenFS → `ensureCloned` lại → reload tree. Đây là bug chắc chắn xảy ra nếu bỏ qua.

#### 1.7 ✅ Border 2px primary - đồng ý, nhưng thêm banner chữ

Chỉ dùng màu viền là tín hiệu duy nhất thì fail cả a11y lẫn UX (user nhìn quen sẽ lờ đi). Thêm một banner mỏng trên cùng: `Đang xem lịch sử · <sha ngắn> · <message> · <thời gian>` + nút **Revert** + **Exit**. Border dùng `outline` chứ không `border` để không làm xô layout, class `.history-review` trên `.page-builder-root` (đúng rule class-không-`data-*` của repo).

---

### 2. Thiết kế chốt lại

```
                    ┌──────────────── GitHub REST (server) ────────────────┐
                    │ GET /repos/:repo/commits?sha=branch[&path=file]      │
                    │ GET /repos/:repo/commits/:sha        (files[] + patch)│
                    │ GET /repos/:repo/contents/:path?ref=sha  (1 file)     │
                    │ pullPagesSourceSnapshot(sha)         (cả cây)         │
                    └───────────────────────┬──────────────────────────────┘
                                            │  routes/page-history.ts (chỉ GET, gate PAGE_BUILDER)
                                            ▼
                       page-components/git/history-http-api.ts
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                             ▼                             ▼
     FileHistoryDialog            HistoryDialog (dock)            reviewCommit state
     (lịch sử 1 file)             (lịch sử cả branch)             (memory, KHÔNG vào ZenFS)
              │                             │                             │
              └────────── revert ───────────┴─────────────────────────────┘
                                            │
                          updateSource / createFile / deleteFile
                                    (seam sẵn có, → ZenFS)
                                            │
                                    Build & publish (dock)
                                            │
              commit "ours-wins" server-side (base_tree = remote HEAD)
                          → build → publish → live
                                            │
                              resync: kéo TOÀN BỘ code về (chốt #7)
```

**Nguyên tắc bất di bất dịch**: đọc lịch sử = REST API (chỉ đọc, server-side). Ghi = luôn qua working copy + Build & publish. Không có đường thứ ba.

---

### 3. Các gói việc

#### Gói 1 - Server: route đọc lịch sử

**File mới `src/server/routes/page-history.ts`** (chỉ `GET`, 4 slug):

| Slug | Trả về | Nguồn |
|---|---|---|
| `""` + `?path=&limit=&page=` | `{ commits: [{sha, message, authorName, date}] }` | `listSnapshotCommits` mở rộng thêm `path`/`page` |
| `commit?sha=` | `{ sha, message, authorName, date, files: [{path, status, additions, deletions, patch?}] }` | `GET /repos/:repo/commits/:sha` |
| `file?sha=&path=` | `{ content }` hoặc `{ missing: true }` | `GET /repos/:repo/contents/:path?ref=` (404 = file chưa tồn tại ở commit đó, **không phải lỗi**) |
| `tree?sha=` | `{ sourceByPath }` | `pullPagesSourceSnapshot(config, sha)` (đã có) |

Sửa `src/server/github-source-sync.ts`:
- `listSnapshotCommits(config, limit, options?: { path?: string; page?: number })` - thêm `&path=`/`&page=` vào query. Giữ nguyên contract `{ok,reason}`.
- thêm `getCommitDetail(config, sha)` và `readFileAtCommit(config, sha, path)` - cùng khuôn `githubRequest`, cùng contract không-throw.
- lọc kết quả `files[]` về đúng 4 root (`PAGES_SOURCE_ROOTS`) - README/CI của repo không phải việc của Page Builder.

`handler.ts`: đăng ký `"page-history": pageHistoryRoute` + gate `PAGE_BUILDER_RESOURCE_ID` cạnh khối `pages-source`/`git`.

**Test** (`routes/page-history.test.ts`, mock `fetch`, theo khuôn `routes/git.test.ts` 11 test): chưa cấu hình → `{configured:false}` 200; thiếu quyền → 403; `?path=` được đưa vào query GitHub đúng; 404 của `contents` → `{missing:true}` chứ không 500; token không lọt vào response.

#### Gói 2 - Client: API wrapper + icon

- `src/page-components/git/history-http-api.ts`: 4 hàm typed + `HistoryCommit`/`HistoryCommitFile` types. Không dynamic import (chỉ là fetch, vài trăm byte).
- `src/components/icons/index.tsx`: thêm `HistoryIcon` (đồng hồ + mũi tên ngược). `UndoIcon` đã có → dùng cho Revert.

#### Gói 3 - Review mode dùng chung (nền của cả 2 luồng history)

Chốt #2: **một** cơ chế review duy nhất, hai phạm vi. Đây là phần lõi, làm trước cả 2 dialog.

State trong `PageBuilder.tsx` (memory, chốt #1 - **không** ghi ZenFS):

```ts
type ReviewTarget =
  | { scope: "file"; path: string }      // history 1 file
  | { scope: "commit" };                 // history all
interface ReviewState {
  sha: string; shortSha: string; message: string; date: string;
  target: ReviewTarget;
  /** Cây source render trong review. */
  sourceByPath: Record<string, string>;
  /** Cần cho nút Revert - xem bảng dưới. */
  restore: { write: Record<string, string>; remove: string[] };
}
```

Cách dựng `sourceByPath` khác nhau theo phạm vi - đây là chi tiết quyết định
chất lượng preview:

| Phạm vi | `sourceByPath` | Lý do |
|---|---|---|
| `file` | cây **hiện tại** với đúng 1 file bị thay bằng bản ở `sha` (gọi `file?sha=&path=`) | Preview phải render được TRANG, mà trang cần layout/component/style **hiện tại**. Nếu lấy cả cây cũ thì đang xem lẫn cả thay đổi của file khác - sai với "xem lịch sử file này". |
| `commit` | **cả cây** tại `sha` (gọi `tree?sha=`) | Đúng nghĩa "toàn bộ code ở commit đó". |

**Bẫy của phạm vi `file`** (phải xử lý, không phải hiếm): bản cũ của file A có
thể `import` một component từ đó đã bị đổi tên/xoá → trộn với cây hiện tại thì
build preview **ném lỗi**. Xử lý: hiện lỗi build ngay trong banner review (code
panel vẫn hiện nội dung readonly bình thường), kèm nút **"Xem cả commit này"**
để nhảy sang `scope: "commit"` - ở đó mọi file đều là bản cũ nên import khớp
lại. Ngoài ra `FileHistoryDialog` cho chọn phạm vi ngay từ đầu (2 nút **Xem
file này** / **Xem cả commit**), để không phải chờ build fail mới biết.

Render:
- `effectiveSource = review ? review.sourceByPath : sourceByPath` - **một** biến duy nhất truyền xuống `PreviewFrame`/`CodePanel`/`FileDialog`, không rẽ nhánh rải rác.
- `Editer` nhận `readOnly` + `key` thêm `sha` (ràng buộc #5 - `readOnly` set-once-at-mount).
- Tắt trong review: Magic Chat, VEI (ép `panelMode = "code"`), tạo/đổi tên/xoá file trong `BubbleMenu`, nút Discard, nút Build & publish, autosave (`updateSource` không được gọi vì editor readonly, nhưng vẫn chặn ở tầng handler cho chắc).
- `Toolbar`/`Dock` ở review mode **chỉ còn 2 nút**: **Revert** + **Exit** (đúng yêu cầu gốc).

Báo hiệu (mục 1.7):
- `src/styles/components.css`: `.page-builder-root.history-review { outline: 2px solid var(--dry-primary); outline-offset: -2px; }`
- banner `.page-builder-history-banner`: `Đang xem lịch sử · <shortSha> · <message> · <thời gian>` + 2 nút.

**Revert** (chốt #3) - đi qua đúng seam sẵn có, rồi mở `SavePreviewDialog`:

| Phạm vi | Hành động |
|---|---|
| `file` | `updateSource(path, old)`; nếu commit đó chưa có file → `deleteFile(path)` |
| `commit` | ghi đè + tạo lại + **xoá** file thừa (mục 1.3), có `ConfirmDialog` liệt kê "Ghi đè X · Tạo lại Y · Xoá Z" |

Sau revert: thoát review (`setReview(null)`) → `setSaveDialogOpen(true)`. Không tự push.

#### Gói 4 - Hai dialog history

- **`FileHistoryDialog.tsx`** (`<dialog class="lg">`): danh sách commit của đúng file đó (`?path=`), mỗi dòng có message/author/thời gian + nút **Xem**. Bấm → đóng dialog → vào review mode `scope: "file"`.
  - Nút mở: icon `HistoryIcon` trong header **`CodePanel.tsx`** (cạnh Discard) và **`FileDialog.tsx`** (cùng chỗ).
- **`HistoryDialog.tsx`** (`<dialog class="lg">`): list commit của branch, phân trang "Tải thêm", mỗi dòng bung ra (`<details>`) gọi `commit?sha=` để hiện file đã đổi + `+N/-M`. Nút **Review** → review mode `scope: "commit"`.
  - Nút mở: `HistoryIcon` trong `extraActions` của `Toolbar.tsx` (Dock giữ nguyên API).
- Cả 2 nút history **ẩn hoàn toàn** khi `gitState.phase === "unconfigured"` (ràng buộc #9 - e2e chạy ở trạng thái này).
- Cache theo `sha` trong memory (commit là immutable) để không gọi lại API khi bung/đóng nhiều lần.

#### Gói 5 - Ép cấu hình GitHub sau lần đăng nhập đầu

- **Route mới `{path}/setup/github`**, render **ngoài** `DryLayout` (cùng cách `SignIn`/`RegisterSuperAdmin` đang làm trong `Chrome`/`AuthGate` của `routers/App.tsx`). Trang chỉ có **một card**: Repository, Branch, Access Token (+ nút Sign out ở góc - mục 1.4).
- **Gate trong `AuthGate`** (chốt #4, hai nhánh):
  - **Có** `canAccess(PAGE_BUILDER_RESOURCE_ID,"setting")` + `GET /api/git/config` trả `configured: false` → `<Redirect to={SETUP_PATH}>` cho mọi path khác (chặn cứng).
  - **Không** có quyền đó → vào app bình thường, chỉ hiện **banner** trên Dashboard: *"Chưa cài đặt GitHub - liên hệ quản trị viên để bật Page Builder"*. Không link tới trang setup (họ không có quyền lưu), không chặn gì.
  - Kết quả `configured` cache trong `gitState` (đã có `fetchGitConfig`), không fetch lại mỗi lần đổi route.
- **Validate thật khi lưu** (món nợ Gói 2 của `status/git-page-source.md` chưa làm): route mới `POST {path}/api/git/validate` → `GET /user` (token sống?) + `GET /repos/{repo}` (`permissions.push === true`?). Lỗi trả về dạng `{fieldErrors: {repo?, token?}}` → hiện **inline trên field**, không toast.
- Chỉ khi validate xanh mới `saveSingleton` + cho đi tiếp.
- **Đổi tên "GitHub Sync" → "GitHub"**: nhãn nav trong `DryLayout.tsx`, `<h1>` + `useDocumentTitle` trong `GithubSyncSettings.tsx`. **Giữ nguyên URL** `/dry/settings/github-sync` (đổi URL chỉ để đổi tên hiển thị là phá bookmark mà không được gì). Trang settings cũ vẫn còn - đó là chỗ sửa về sau; trang setup là chỗ nhập lần đầu.

#### Gói 6 - Publish không bao giờ conflict + kéo toàn bộ về sau publish (chốt #6, #7)

Đây **không** phải phần history, nhưng phải làm chung vì Revert đẩy file cũ đi
qua đúng đường publish này - nếu đường đó còn có thể bị từ chối thì Revert
cũng bị kẹt.

**Hiện trạng cần bỏ**: `saveAndPublish` (`PageBuilder.tsx:510`) và
`pushWorkingCopy` (`PageBuild.tsx:101`) đang `commitAll` + `push` bằng
isomorphic-git qua git proxy; push bị từ chối (non-fast-forward) thì ném lỗi
*"GitHub rejected the push - reload rồi save lại"*. Chốt #6 xoá hẳn trạng
thái này.

**Thay bằng: commit "ours-wins" server-side qua Git Data API.**

Route mới `POST {path}/api/pages-source/commit`, body
`{ message, author, files: Record<path, string | null> }` (`null` = xoá file):

1. `GET /repos/:repo/git/ref/heads/:branch` → remote HEAD **lúc này** (không
   phải HEAD lúc clone - đây là mấu chốt).
2. `GET /repos/:repo/git/commits/:sha` → tree hiện tại của remote.
3. `POST /git/blobs` cho từng file có nội dung.
4. `POST /git/trees` với **`base_tree` = tree ở bước 2** + entries của mình.
   Xoá file = entry `{ path, mode: "100644", type: "blob", sha: null }`.
   → **Đây chính là "ghi đè theo từng file"**: file mình gửi thì đè, file
   không gửi thì thừa hưởng nguyên vẹn từ remote.
5. `POST /git/commits` (parent = remote HEAD ở bước 1, `author` = user đang
   đăng nhập, giữ nguyên quy ước email `<id>@page-builder.drycms`).
6. `PATCH /git/refs/heads/:branch` với `force: false` → luôn là
   fast-forward nên **không bao giờ bị từ chối**.
7. Nếu bước 6 vẫn fail (có người push đúng khe giữa bước 1 và 6) → **retry
   tối đa 3 lần từ bước 1**, không hiện lỗi cho user. Đây là chỗ duy nhất
   còn khái niệm "đụng độ", và nó tự giải quyết.

Lợi phụ đáng kể: đường ghi không còn đi qua smart-HTTP push nữa
→ có thể bỏ `git-receive-pack` khỏi allowlist của `routes/git.ts` và hạ
`MAX_GIT_BODY_BYTES` (50 MiB) về mức thường. Proxy còn lại **chỉ đọc**.
(Làm ở cuối gói, sau khi xác nhận không còn caller nào push.)

**Kéo toàn bộ về sau publish** (chốt #7) - chạy sau khi build + publish xong:

- `resyncWorkingCopy()` mới trong `git-repo.ts`: xoá `/repo` trong ZenFS →
  `ensureCloned` lại (đơn giản và chắc hơn fetch+reset trên shallow clone).
- rồi `reload()` của `use-page-builder-source.ts` → cây trong editor hiện
  luôn file của người khác vừa về.
- **Ở dev**: mirror **cả cây** xuống `.dry/pages-source` (hiện `mirrorToDisk`
  chỉ mirror từng file lúc ghi) để Vite HMR/dev SSR không tụt lại bản cũ.
- An toàn với edit đang gõ: lúc này `SavePreviewDialog` đang mở ở trạng thái
  progress (không đóng được), nên không có buffer nào đang chạy. Vẫn gọi
  `flushPendingWrites()` trước cho chắc.

**Dọn theo**:
- `git-repo.ts`: `push()` + `PushResult.rejected` thành code chết → xoá.
  `commitAll` cũng không còn caller (commit giờ ở server) → xoá.
- `PageBuilder.tsx`: bỏ nhánh `pushed.rejected` và message "reload rồi save
  lại".
- `ensureCloned`'s `diverged`: vẫn giữ cho lúc BOOT (không được tự xoá edit
  chưa publish của user), nhưng nó không còn chặn publish nữa - publish giờ
  không quan tâm lịch sử local.

**Test**: `routes/pages-source-commit.test.ts` (mock `fetch`) - `base_tree`
được truyền đúng, xoá file gửi `sha: null`, remote di chuyển giữa chừng →
retry rồi thành công, retry cạn → lỗi rõ ràng; và **file không gửi lên thì
không có trong tree entries** (đây là assert chống hồi quy quan trọng nhất
của chốt #6).

#### Gói 7 - Reset pages 2 commit

- `github-source-sync.ts`: thêm `resetBranchToSnapshot(config, sourceByPath, messages)` - commit A (empty tree sha, parent = HEAD cũ) → commit B (mock, parent = A) → **1 lần** `PATCH ref` sang B (mục 1.5).
- `routes/pages-source-github-sync.ts` `PUT` chuyển sang gọi hàm này thay vì `pushPagesSourceSnapshot`.
- `GithubSyncSettings.tsx` `resetAllPages()`: sau khi server trả `applied: true` → **re-clone working copy** bằng chính `resyncWorkingCopy()` của Gói 6 → rồi mới `publishAllPages` (mục 1.6). Confirm dialog phải nói rõ *"mọi thay đổi chưa publish trong trình duyệt này sẽ mất"*.

---

### 4. Rủi ro / điểm phải canh

1. **Rate limit GitHub**: mở dialog history all + bung 10 commit = 11 request. PAT có 5000/h nên ổn, nhưng phải cache theo `sha` trong memory (commit là immutable - cache vĩnh viễn trong phiên là đúng) và không tự động bung tất cả.
2. **Commit trên 300 file**: `GET /commits/:sha` cắt `files[]` ở 300. Hiển thị "và N file nữa" thay vì im lặng.
3. **`patch` có thể rất lớn**: chỉ render patch khi user bấm vào từng file, không render sẵn cả commit.
4. **Repo private + không có token** → mọi route history trả `not-configured`; UI phải ẩn nút chứ không hiện nút rồi báo lỗi khi bấm.
5. **e2e** chạy `unconfigured` (ràng buộc #9): thêm assert "không có nút History khi chưa cấu hình git" để khoá hành vi này lại; phần history thật phải QA bằng Chromium trên repo thật (đúng cách `status/git-page-source.md` đã QA Gói 3/5).
6. **Gate setup GitHub** dễ gây khoá chết - phải có test cho đúng 3 lối thoát ở mục 1.4 trước khi bật.

### 5. Thứ tự & ước lượng

```
Gói 6 (publish ours-wins + resync) ──> Gói 1 (server) ──> Gói 2 (api+icon)
                                              └──> Gói 3 (review mode) ──> Gói 4 (2 dialog)
Gói 5 (setup gate)     ── độc lập, làm song song được
Gói 7 (reset 2 commit) ── độc lập, nhỏ nhất, dùng lại resync của Gói 6
```

**Gói 6 làm TRƯỚC**: Revert đẩy file cũ qua đúng đường publish đó, nên đường
publish phải hết trạng thái "bị từ chối" trước khi có nút Revert. Nó cũng là
gói duy nhất đụng vào code đã chạy thật, nên làm sớm để có nhiều thời gian QA.

| Gói | Ước lượng |
|---|---|
| 6 - publish ours-wins + resync sau publish | 1 ngày |
| 1 - route đọc lịch sử + test | 0.5 ngày |
| 2 - wrapper + icon | 0.25 ngày |
| 3 - review mode dùng chung | 0.75 ngày |
| 4 - 2 dialog history | 0.75 ngày |
| 5 - setup gate + banner + validate PAT | 0.75 ngày |
| 7 - reset 2 commit | 0.25 ngày |
| **Tổng** | **~4.25 ngày** |

Gói 1-4 là một chuỗi (ship được sau Gói 4). Gói 5 độc lập hoàn toàn.

## Status

Chưa bắt đầu code. Kế hoạch viết xong 2026-08-17 sau khi đọc lại toàn bộ
đường git hiện tại (`git-repo.ts`, `git-state.ts`,
`use-page-builder-source.ts`, `routes/git.ts`, `github-source-sync.ts`,
`pages-source-github-restore.ts`) và đối chiếu với `plans/history-code-page.md`.

**Đã chốt 7 quyết định với user** (bảng đầu mục Plan) - kế hoạch bên dưới đã
cập nhật theo. Không còn câu hỏi chặn; sẵn sàng bắt đầu **Gói 6** (đường
publish phải hết trạng thái "bị từ chối" trước khi có nút Revert).

Ba điểm user KHÔNG phải chọn vì không phải lựa chọn mà là lỗi phải tránh,
đã nằm sẵn trong plan: xoá file thừa khi revert cả commit (1.3), re-clone
working copy sau Reset pages (1.6), và banner chữ kèm viền primary (1.7).

## Speed

Chưa có blocker kỹ thuật. Không cần thêm dependency mới - toàn bộ phần đọc
lịch sử dùng lại `githubRequest` sẵn có, phần UI dùng lại `Editer`/
`ConfirmDialog`/`useDialogSync` sẵn có.
