# Page Builder thành surface sửa code duy nhất (bỏ VEI public + xoá Page Editor)

## Plan

Phần 1 của kế hoạch trong `/Users/kcoder/.claude/plans/transient-sparking-ullman.md`
(phần 2 - git/ZenFS - nằm ở `status/git-page-source.md`, chưa bắt đầu).

Quyết định user chốt 2026-08-16/17:

- Bỏ VEI trên site public; nút Edit ở đó đi thẳng vào Page Builder.
- Dock Page Builder thêm 2 nút icon: Dashboard, x (x = quay về trang public
  đang xem).
- Xoá hoàn toàn Page Code Editor (`/dry/page-editor`), sau khi **port**:
  Magic Chat + tạo/đổi tên/xoá file + panel System core styles.
  KHÔNG port: device preview, 2 dialog GitHub History/Reset (git sẽ thay).

## Status

Hoàn thành. `bun run typecheck` sạch, `bun run test` 1409/1409 pass,
`bun run build` + `bun run build:worker` OK, `bun run test:e2e` 28/28 pass.

### 1. VEI public - xoá

Xoá: `src/apps/vei/{overlay.ts,overlay-styles.ts}`, `src/apps/vei-live-refresh.ts`,
`src/pages/vei/ChangesPreview.tsx` (+ route `/dry/vei/changes`),
`src/server/vei-routes.ts` (+ test), cookie `drycms_vei` (`vei-session.ts`),
`render.ts`'s `spliceVeiScripts`/`buildVeiShellDocument`, nhánh VEI trong
`page-handler.ts`, fallback VEI-session trong `handler.ts`, hook
`handleVeiRoute` ở `entry-node.ts`/`entry-worker.ts`/`scripts/dev-server.mjs`,
2 entry Vite `appsVeiOverlay`/`appsVeiLiveRefresh`.

Giữ (Page Builder đang dùng thật): `dry-vei.ts`/`dry-vei-ref.ts`/
`vei-marker-hook.ts`/`vei-preview-patch.ts`/`page-preview-engine.ts`.

Chuyển chỗ:
- `apps/vei/Dock.tsx` -> `pages/page-components/page-builder/Dock.tsx`, cắt
  hết phần chỉ overlay dùng (EditButtonDock, ModeToggle, Preview all,
  `EditingDockHandle`).
- `pages/vei/{bridge.ts,VeiFrame.tsx}` ->
  `pages/content-entry-editor/{builder-bridge.ts,BuilderBridgeFrame.tsx}`
  (đây là nửa admin của iframe `?_vei=1`, thứ `VeiEntryFrame.tsx` vẫn dùng).

Thay thế: `src/apps/edit-launcher.ts` (~40 dòng, shadow root, CSS tự viết,
không kéo tokens.css) - vẫn gate bằng hint cookie `drycms_admin` đọc
CLIENT-side (HTML built dùng chung cho mọi khách nên không thể bake vào
document). `vei-session.ts` rút gọn thành `admin-hint-cookie.ts` (chỉ còn
hint cookie). `veiConfigScript` -> `editConfigScript` (`#dry-edit-config`,
bỏ hẳn `edit` flag). `veiOverlayHref` đổi tên thành `editLauncherHref` xuyên
suốt pipeline build.

### 2. Dock

`Toolbar.tsx` -> `Dock.tsx` mới: [menu][VEI][code] · Dashboard · Save · x.
Dashboard -> `/dry/dashboard`; x -> `window.location.href = pathname` (trang
public đang preview).

### 3. Port trước khi xoá Page Editor

- **Magic Chat**: `page-editor/PageSourceMagicChat.tsx` + store ->
  `page-components/page-builder/`, mount ở `PageBuilder.tsx` với
  `path = fileDialogPath ?? match.entryPath`, `onCodeChange -> updateSource`
  (nên write của Magic vào file KHÔNG mở vẫn nằm trong `dirtyPaths` và ra
  đúng dialog Save).
- **File CRUD**: `createFile`/`renameFile`/`deleteFile` thêm vào
  `use-page-builder-source.ts` - MỘT seam duy nhất, cố ý, để lần chuyển sang
  git/ZenFS chỉ phải sửa một chỗ. `renameFile` gọi `rewriteImportsAfterMove`
  rồi lưu luôn các file bị rewrite. UI: nút "New file" ở header BubbleMenu +
  nút rename/delete trên từng dòng file; `globals/theme/base.css` không hiện
  nút delete (server cũng chặn).
- **Core styles**: check recover file `styles/` thiếu chuyển từ `loadTree`
  của Page Editor sang effect trong `PageBuilder.tsx`; `SystemFilesPanel`
  hiện phía trên cây ở tab styles.

### 4. Xoá Page Editor

`PageEditor.tsx` (2733 dòng), `ComponentTreePanel.tsx`,
`GithubHistoryDialog.tsx`, `GithubResetDialog.tsx`, `DevicePickerControls.tsx`,
`page-source-draft-db.ts`, `page-source-cache-db.ts`,
`page-components/github-restore-http-api.ts`, `e2e/page-editor.spec.ts`,
route + mục nav. `useDevicePreview.ts` GIỮ LẠI (FileDialog dùng).
`GithubSyncSettings.tsx` bỏ 2 lời gọi cache của Page Editor.

### 5. Test

`e2e/page-builder.spec.ts` mới (4 test): dock có Dashboard/x + Magic Chat
mount; tạo/đổi tên/xoá file; site public có đúng 1 nút Edit deep-link vào
builder và không còn `#dry-vei-config`/cookie `drycms_vei`; file style built-in
không có nút xoá.

Bug thật bắt được khi QA (đã sửa):
1. Form "New file" ban đầu bắt path phải nằm trong tab đang mở -> gõ
   `component/...` khi đang ở tab `pages/` bị chặn. Giờ nhận mọi root và tự
   chuyển tab.
2. Chuyển tab SAU khi tạo file làm bubble menu bật lại ngay sau khi vừa đóng
   -> chuyển tab trước khi ghi.

## Speed

Xong trong 1 phiên, không blocker.

Nợ lại (có chủ ý):
- Route `/api/github-restore` + `listSnapshotCommits`/`pullPagesSourceSnapshot`
  giờ KHÔNG còn UI nào gọi (2 dialog History/Reset đã xoá). Để nguyên chờ
  phần git thay bằng `git log`/checkout - xem `status/git-page-source.md`.
- `PageBuild.tsx`'s `?autoBuild=` mode mất consumer duy nhất (rebuild headless
  của VEI overlay). Code còn đó, có thể dùng lại nếu sau này build từ CI.
- Page Builder vẫn chưa persist edit chưa lưu qua reload (Page Editor có
  IndexedDB draft, đã xoá). ZenFS ở phần git sẽ giải quyết.
