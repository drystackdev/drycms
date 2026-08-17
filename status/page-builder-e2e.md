# E2E cho toàn bộ tính năng Page Builder

## Plan

Page Builder giờ là surface DUY NHẤT để sửa page-source (Page Editor code +
VEI overlay đã xoá), nhưng coverage e2e chỉ còn 4 test cũ. Mục tiêu: phủ hết
tính năng của `/dry/page-builder`, chia theo khu vực để mỗi file đọc được độc
lập.

| File | Phủ cái gì |
| --- | --- |
| `e2e/page-builder.spec.ts` | Vỏ trang: dock (6 nút), preview render + điều hướng trong iframe, 3 panel, khôi phục state sau reload, ra/vào trang (Dashboard, x, nút Edit ở site public) |
| `e2e/page-builder-files.spec.ts` | Bubble file menu: 4 root, cây thư mục, validate đường dẫn, tạo/đổi tên (rewrite import)/xoá, khoá xoá file style lõi |
| `e2e/page-builder-editing.spec.ts` | Autosave, problems panel, breadcrumb layout, dialog component (preview + viewport + zoom), dialog style, Magic Chat, Ctrl+S trong preview |
| `e2e/page-builder-publish.spec.ts` | Dialog Build & publish: danh sách thay đổi, Preview/Revert/Cancel, build+publish thật ra `built/live/*` |
| `e2e/page-builder-vei.spec.ts` | Visual editing: marker `data-dry`, mở form entry thật, sửa field → preview đổi + xếp hàng thành content draft, revert |
| `e2e/page-builder-utils.ts` | Helper dùng chung (không phải spec) |

## Ràng buộc quan trọng của môi trường e2e

`scripts/e2e-server.mjs` cố tình xoá trắng `GITHUB_REPO`/`GITHUB_BRANCH`/
`GITHUB_PAT_KEY`, nên **mọi test chạy ở nhánh KHÔNG có git** của
`use-page-builder-source.ts` (`usingGit === false` → đọc/ghi qua HTTP
`/api/pages-source`). Nhánh working-copy bằng git (ZenFS + isomorphic-git,
commit/push khi Build & publish) không thể phủ ở đây vì cần một remote thật để
clone; phần đó do `src/server/routes/git.test.ts` và unit test quanh
`git-state` giữ.

## Status

Xong 2026-08-17. **48/48 e2e xanh** (24 test mới cho Page Builder), 1423/1423
unit, typecheck sạch, `bun run build` + `bun run build:worker` OK. Chạy full
suite 4 lần: 24 test Page Builder xanh cả 4; một lần `richtext-ime.spec.ts`
(spec cũ, không liên quan) flaky - đã kiểm riêng, nó tự flaky sẵn.

Trong lúc viết test đã tìm ra **6 lỗi thật**, tất cả đều đã sửa:

### 1. Không có repo git thì không publish được code (regression)

Sau khi bỏ nút Save, `pendingCommitPaths` chỉ còn là "buffer chưa ghi". Autosave
làm nó rỗng sau ~400ms, nên chỉnh sửa xong là nút **Build & publish tắt hẳn,
badge = 0** - thay đổi nằm trong storage nhưng không có đường nào đưa lên site.
Chỉ ảnh hưởng tenant chưa nối git (có git thì `git.statusMatrix` trả lời được).

Sửa: thêm sổ "đã ghi nhưng chưa publish" (`UNPUBLISHED_KEY`, sessionStorage) do
`writeThrough`/`moveThrough`/`removeThrough` ghi vào và `markPublished()` xoá
sau khi build xong. Tách luôn `isDirty` (chưa publish) khỏi `canDiscard` (có
mốc để hoàn tác không) - không git thì sau khi autosave đúng là không còn gì
để Discard, nên nút tắt là đúng chứ không phải hỏng.

### 2. Tạo page mới từ file menu không có phản hồi gì

`handleCreateFile` gọi `handleSelectPageFile`, mà hàm đó resolve qua `manifest`
- memo tính từ `sourceByPath` của render TRƯỚC đó, nên file vừa tạo không bao
giờ có trong đó. Kết quả: bấm Create một `pages/**/page.tsx` → menu đóng, không
mở gì cả, preview đứng nguyên trang cũ.

Sửa: `staticPathnameForPageFile()` suy pathname thẳng từ đường dẫn file
(`pages/about/page.tsx` → `/about`); template động (`[slug]`) vẫn đi đường
manifest cũ vì cần một entry thật để preview.

### 3. VEI mất marker ngẫu nhiên (~1/3 số lần build)

`buildPage` không re-entrant: mọi thứ render cần để tới `dry()` đi qua state
toàn cục (`configureHttpDryReader`: call log, deps, và `vei` - thứ quyết định
có bọc giá trị hay không), mà hàm này `await` nhiều lần trước và trong lúc
component chạy. Một build thứ hai chen vào giữa sẽ thay config mà build thứ
nhất sắp đọc.

Gặp thật: initial publish của admin (`initial-publish.ts`, không có `vei`) đè
lên build preview của Page Builder (có `vei`) → trang trả về **không có
`data-dry` nào và replay log rỗng** → bật Visual editing lên không bấm được gì,
cho tới khi có sửa đổi khác tình cờ build lại sạch. Hai lần publish chồng nhau
làm hỏng `_page_deps` của nhau y hệt, chỉ khó thấy hơn.

Sửa: xếp hàng `buildPage` (`buildQueue`). Có regression test riêng
(`page-build.test.ts` - "does not let an overlapping build steal its reader
config"), đã xác nhận test FAIL nếu bỏ hàng đợi.

### 4. Sửa field của singleton qua VEI không bao giờ hiện ra preview

`ContentEntryEditor` phát `dry:field-input` kèm `entryId` = id thật của row,
trong khi mọi chỗ tiêu thụ định danh này đều quy ước singleton = `null`
(`entry-draft-store.ts`, `dryVeiOverrideKey`, và `dry-reader-http.ts` -
hardcode `null` cho `kind: "singleton"`). Override rơi vào một key không ai tra.
Triệu chứng: badge lên 1 nhưng preview giữ nguyên giá trị cũ vĩnh viễn.

Sửa: phát sự kiện bằng `draftEntryId` (biến đã có sẵn, đúng quy ước) cho cả
`dispatchFieldInput` lẫn `dispatchFieldFocus`.

### 5. Đổi tên file ngay sau khi gõ có thể rewrite import theo bản cũ

`renameFile` rewrite import dựa trên `sourceByPath`, nhưng một edit vừa gõ còn
nằm trong debounce tới `AUTOSAVE_DELAY_MS`. Đổi tên trong cửa sổ đó thì file
importer bị rewrite theo nội dung TRƯỚC đó - im lặng để lại một import trỏ vào
đường dẫn không còn tồn tại. Sửa: `renameFile` gọi `flushPendingWrites()`
trước khi move. (Bắt được vì một lần chạy e2e trùng lúc máy đang chạy
`bun run build`, đủ chậm để lộ ra.)

### 6. `onChange` rỗng bị tính là sửa đổi

`Editer` phát `onChange` khi mount (và sau khi format). `updateSource` xếp lịch
ghi vô điều kiện, nên chỉ MỞ một file trong code panel là nó bị ghi lại xuống
storage và bị đếm là "chưa publish". Sửa: bỏ qua khi `code` bằng đúng nội dung
đang lưu, đồng thời huỷ debounce đang chờ.

## Ghi chú còn lại (chưa sửa, không chặn)

- `PageBuilder.tsx`'s `handleFieldInput` gọi `applyPreviewPatch(doc, ...)` với
  `iframeRef.current?.contentDocument` - preview iframe sandbox không có
  `allow-same-origin` nên `contentDocument` luôn `null`, nhánh đó là code chết.
  Preview vẫn đúng nhờ rebuild theo `veiOverrides`, chỉ chậm hơn một nhịp.
- `import-rewrite.ts` chỉ nhận ra specifier có đuôi (`"./Widget.tsx"`); viết
  `"./Widget"` thì đổi tên file sẽ KHÔNG rewrite import. E2E dùng đúng dạng có
  đuôi (giống unit test của nó) và ghi chú lại tại chỗ.
- Sổ "chưa publish" là sessionStorage nên publish từ `/dry/page-build` không
  xoá nó → có thể thừa một lần build lại (idempotent, vô hại).

## Speed

Toàn bộ suite ~1.8 phút (48 test, 1 worker). Riêng 24 test Page Builder ~1
phút. `openFileMenu` có retry vì dev server thỉnh thoảng re-optimize dep và
reload cả trang, làm mất state của bubble menu.
