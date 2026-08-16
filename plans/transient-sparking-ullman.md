# Page Builder thành surface duy nhất + git là nguồn code duy nhất

## Context

Hôm nay có 3 chỗ cùng làm một việc "sửa page-source": `/dry/page-editor`
(editor code đầy đủ), `/dry/page-builder` (preview toàn màn hình + code + VEI),
và VEI overlay trên site public (`src/apps/vei/overlay.ts`, 1237 dòng). Cả ba
ghi vào cùng `pagesSourceStorage` (R2/`.dry/pages-source`) theo 3 đường khác
nhau - trùng lặp logic, 3 chỗ phải sửa mỗi lần đổi hành vi, và là lý do chính
khiến việc chuyển sang git khó.

Mục tiêu cuối:

1. **Page Builder là surface duy nhất** để sửa code + content inline. VEI
   public và Page Editor bị xoá; nút Edit trên site public deep-link thẳng vào
   Page Builder.
2. **Git (isomorphic-git + ZenFS trong browser) là nguồn code duy nhất**, PAT
   bắt buộc, vào admin là clone/fetch ngay, commit lên `main` thì tự động
   build + publish đúng file đã sửa.

Làm Phần 1 trước: mỗi surface bị xoá là một đường ghi vào R2 không phải
migrate sang git nữa.

---

## Phần 1 - Bỏ VEI public + xoá Page Editor

### 1.1 Kiểm kê VEI: xoá gì / giữ gì (đã trace hết, dễ sai nhất ở đây)

**XOÁ - chỉ phục vụ overlay trên site public:**

- `src/apps/vei/overlay.ts`, `src/apps/vei/overlay-styles.ts` (CSS shadow-root
  riêng; dock trong Page Builder đã có CSS riêng ở `src/styles/components.css`
  ~dòng 7605-7670, không phụ thuộc file này).
- `src/apps/vei-live-refresh.ts` (VEI render 100% client trên site public).
- `src/pages/vei/ChangesPreview.tsx` + route `${path}/vei/changes` trong
  `src/routers/App.tsx` (chỉ mở từ nút "Preview all" của overlay;
  `SavePreviewDialog.tsx` của Page Builder dùng `EntryPreviewDialog` khác, đã
  kiểm tra).
- `src/server/vei-routes.ts` (`/vei/enter`, `/vei/exit`) + `vei-session.ts`
  (cookie `drycms_vei`, `mintVeiToken`), và các call site: `entry-node.ts:94`,
  `entry-worker.ts:99`, `handler.ts:192` (session fallback theo cookie VEI),
  `page-handler.ts:150` (nhánh VEI shell), `render.ts`'s
  `buildVeiShellDocument`, exemption CSRF cho `dry-http`, bypass VEI trong
  `edge-cache.ts`.
- Wiring asset: `veiConfigScript`/thẻ `<script src=veiOverlayHref>` trong
  `build-document.ts:140-180`, `VEI_OVERLAY_HREF`/`VEI_LIVE_REFRESH_HREF`
  (`app-router/assets.ts`, `generated-asset-hrefs.ts`, `asset-hrefs-plugin.ts`),
  field `veiOverlayHref` trong `routes/asset-hrefs.ts`, 2 entry
  `appsVeiOverlay`/`appsVeiLiveRefresh` trong `vite.config.ts:201,218`.

**GIỮ NGUYÊN - Page Builder đang dùng thật:**

- `src/content-types/dry-vei.ts` (`dryBind`), `dry-vei-ref.ts`,
  `app-router/vei-marker-hook.ts`, `page-components/vei-preview-patch.ts`,
  phần đánh dấu VEI trong `dry-reader-http.ts`, và `intercept`/marker styles
  tự có trong `page-components/page-preview-engine.ts` (preview của Page
  Builder **strip** thẻ overlay ra - `page-preview-engine.ts:190` - nên nó
  không hề phụ thuộc `overlay.ts` lúc chạy).
- `src/pages/vei/bridge.ts` + `VeiFrame.tsx`: đây là nửa **admin** của cầu
  `?_vei=1`, chính là thứ `page-builder/VeiEntryFrame.tsx` đang dùng để nhúng
  form entry. **Chuyển** sang `src/pages/content-entry-editor/` (cạnh
  `field-events.ts`, phụ thuộc duy nhất của nó), cập nhật import ở
  `App.tsx:21-22,124,151` và `VeiEntryFrame.tsx`.

**CHUYỂN:** `src/apps/vei/Dock.tsx` -> `src/pages/page-components/page-builder/Dock.tsx`
(`Toolbar.tsx:1` đang import `EditingDock` từ đây). Nhân tiện cắt phần chỉ
overlay dùng: `EditButtonDock`, `ModeToggle`/`showModeToggle`, `onPreviewAll`/
`previewCount`, handle `setStatus`/`setSaving` (Page Builder truyền
`onReady={() => {}}`, `showModeToggle={false}`, `onPreviewAll={() => {}}`).

### 1.2 Nút Edit trên site public -> Page Builder

Thay `overlay.ts` bằng một module launcher tí hon `src/apps/edit-launcher.ts`
(~40 dòng), giữ đúng cơ chế đang chạy:

- `build-document.ts` vẫn nhúng 1 thẻ JSON config (đổi id thành
  `dry-edit-config`, chỉ còn `{"path"}`) + `<script src=editLauncherHref>`.
- Launcher đọc **hint cookie `drycms_admin`** ở client (như overlay đang làm)
  để quyết định có render nút hay không - bắt buộc giữ ở client vì HTML built
  được cache dùng chung cho mọi khách.
- Nút Edit -> `location.href = "${path}/page-builder?path=" + encodeURIComponent(location.pathname + location.search)`
  (mở cùng tab; nút **x** ở dock đưa ngược lại đúng trang này).
- Cookie hint trong `routes/auth.ts` giữ lại, đổi tên `veiHintCookieHeader`
  -> `adminHintCookieHeader`; `clearVeiCookieHeader` (cookie VEI thật) xoá.

### 1.3 Dock Page Builder: thêm 2 nút icon

Trong `page-builder/Toolbar.tsx` + `Dock.tsx` vừa chuyển về:

- **Dashboard** - `DashboardIcon` (đã có ở `components/icons/index.tsx:133`),
  đổi nút text "Dashboard" sẵn có của `EditingDock` thành `icon ghost round`
  -> `${path}/dashboard`.
- **x** - `CloseIcon` (`icons/index.tsx:238`) -> thoát về trang public đang
  xem: `location.href = pathname` (state `pathname` Page Builder đã giữ sẵn).
  Hiện `onExit` đang trỏ `${path}/dashboard` (`PageBuilder.tsx:402`) - sửa lại,
  và bật `showExit`.

### 1.4 Port sang Page Builder TRƯỚC khi xoá Page Editor

- **Magic Chat**: `src/pages/page-editor/PageSourceMagicChat.tsx` +
  `page-source-magic-chat-store.ts` -> `src/pages/page-components/page-builder/`.
  Props của nó (`path`, `code`, `projectFiles`, `onCodeChange`, `canUse`) khớp
  100% với state Page Builder đang có; gắn vào `CodePanel.tsx` (và
  `FileDialog.tsx`) như một tab/ngăn, `onCodeChange` nối thẳng
  `updateSource(path, code)` của `use-page-builder-source.ts`.
- **File CRUD**: thêm tạo file/folder, đổi tên, xoá, di chuyển vào
  `BubbleMenu.tsx`/`BubbleFileTree.tsx` (hiện cố tình bỏ hết thao tác ghi -
  `BubbleMenu.tsx:42`). Dùng lại `createPagesSourceApi`
  (`page-components/pages-source-http-api.ts`) và `rewriteImportsAfterMove`
  (`page-components/import-rewrite.ts`) y như Page Editor. **Quan trọng**: cho
  hết các thao tác ghi này đi qua đúng một seam trong
  `use-page-builder-source.ts` (thêm `createFile`/`renameFile`/`deleteFile`),
  để Phần 2 chỉ phải đổi một chỗ khi chuyển sang ZenFS.
- **Panel System core styles**: `src/pages/page-components/core-styles/*`
  (`SystemFilesPanel`, `GlobalsCssFile`, `ThemeCssFile`, `BaseCssFile`,
  `registry.ts`) gắn thành một mục "System" trong bubble file menu.
- **Không port** (theo quyết định): device preview (`useDevicePreview.ts`,
  `DevicePickerControls.tsx`) và 2 dialog GitHub History/Reset - History/Reset
  sẽ do Phần 2 cấp lại bằng `git log`/checkout ngay trong Page Builder.

### 1.5 Xoá Page Editor

Sau khi 1.4 chạy được: xoá `src/pages/PageEditor.tsx` (2733 dòng),
`src/pages/page-editor/` (phần còn lại sau khi port), `page-components/
ComponentTreePanel.tsx`, `GithubHistoryDialog.tsx`, `GithubResetDialog.tsx`,
`useDevicePreview.ts`, `DevicePickerControls.tsx`, `page-source-draft-db.ts`,
`page-source-cache-db.ts`, `e2e/page-editor.spec.ts`; gỡ route
`App.tsx:212-215` + mục nav `DryLayout.tsx:154-157`. Gỡ luôn 2 call
`clearPageSourceCache`/`replacePageSourceCacheOrThrow` trong
`GithubSyncSettings.tsx` (chúng chỉ nuôi cache của Page Editor).

`/dry/page-build` (Build all) **giữ nguyên**. Chế độ `?autoBuild=` mất consumer
duy nhất (rebuild headless của VEI) nhưng để lại - Phần 2 có thể dùng nếu sau
này cần build từ CI.

---

## Phần 2 - Git + ZenFS là nguồn code duy nhất

Kế hoạch chi tiết đã viết ở **`status/git-page-source.md`** (giữ file đó làm
nguồn theo dõi tiến độ). Tóm tắt để duyệt:

- **G0 Spike** (làm trước tiên): `clone(depth:1)` -> commit -> push qua proxy
  của chính mình, trên repo thật. Trả lời 3 câu: push từ shallow clone có bị
  từ chối không, Worker stream được `git-upload-pack`/`git-receive-pack` không,
  bundle + IndexedDB tốn bao nhiêu.
- **G1** `githubSync` thành bắt buộc + validate PAT thật (`GET /user`,
  `permissions.push`, lỗi hiện inline trên field) + route mới
  `src/server/routes/git-proxy.ts` (`${path}/api/git/*`, allowlist đúng 3
  endpoint git smart-HTTP, repo lấy từ config server chứ không từ client,
  stream 2 chiều, gate `PAGE_BUILDER_RESOURCE_ID`). PAT không bao giờ ra
  browser.
- **G2** `src/page-components/git/` (ZenFS IndexedDB + isomorphic-git, dynamic
  import, Web Locks chống 2 tab ghi cùng lúc). `AuthenticatedApp`
  (`routers/App.tsx`) clone/fetch ngay sau khi đăng nhập. Repo/branch trống ->
  `ensureBranchExists` (đã có ở `server/github-source-sync.ts`) tạo commit đầu
  từ `mock/`.
- **G3** `use-page-builder-source.ts` đọc/ghi ZenFS thay cho HTTP; dirty list
  lấy từ `git.statusMatrix`; luồng **Commit & Deploy** trong dock; push bị từ
  chối -> dialog chọn theo file (không tự merge). Ở dev vẫn PUT xuống
  `/api/pages-source` để Vite HMR/live preview không đổi.
- **G4** Push xong -> diff `oldHead..newHead` -> build + publish đúng page bị
  ảnh hưởng, dùng lại `publishPagesAffectedBySource`
  (`page-components/initial-publish.ts`, refactor để nhận source loader tiêm
  vào). Lưu `lastBuiltCommit` để lần vào admin sau build bù các commit tạo từ
  VS Code/MCP/GitHub web.
- **G5** R2 `pagesSourceStorage` thành **mirror derived** (server sync sau mỗi
  push), `/api/pages-source` chỉ còn ghi bởi mirror writer + cầu dev.
- **G6** MCP `write_page_source` + Magic Chat `kind:code` chuyển sang commit
  server-side (Git Data API, gộp 1 commit/lượt).

Ràng buộc phải nhắc lại vì nó định hình G4: **server không build được** -
`page-build.ts` dùng `new Function` (workerd chặn) và `tailwind-build.ts`
compile Tailwind trong iframe thật. Nên "commit là deploy" chỉ xảy ra khi có
tab admin mở; commit từ nơi khác được build bù ở lần vào admin kế tiếp.

---

## Thứ tự thực hiện

1. Phần 1 (1.1 -> 1.5) - xong là chỉ còn 1 surface sửa code.
2. G0 spike.
3. G1 -> G4 (sau G4 là dùng thật được).
4. G5, G6, rồi dọn tài liệu (`CLAUDE.md`/`AGENTS.md` mục "Page source lives
   only in pagesSourceStorage", `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`).

## Verification

Sau Phần 1:

- `bun run typecheck`, `bun run test`, `bun run build`, `bun run build:worker`
  (bắt sót import tới file đã xoá - nhất là các entry trong `vite.config.ts`).
- `bun run test:e2e` (đã gỡ `page-editor.spec.ts`; các spec còn lại phải xanh).
- Thủ công trên `bun run dev`: mở 1 trang public khi đã đăng nhập -> thấy nút
  Edit -> bấm -> vào `/dry/page-builder?path=<đúng route>` -> dock có
  Dashboard + x -> x quay lại đúng trang public đó; đăng xuất -> không còn nút
  Edit; xem HTML built của 1 trang: không còn `<script>` overlay.
- Trong Page Builder: tạo file mới -> đổi tên (kiểm tra import trong file khác
  được rewrite) -> xoá; mở panel System sửa `theme.css`; Magic Chat viết 1 file
  rồi Save + Build.
- Kiểm tra không còn cookie `drycms_vei` được set và `/dry/vei/enter` trả 404.

Sau Phần 2: theo mục Verification/Status trong `status/git-page-source.md` -
spike G0 phải chạy trên repo + PAT thật trước khi viết tiếp G1.
