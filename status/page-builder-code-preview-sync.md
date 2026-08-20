# Page Builder: hover/cursor sync giữa Code panel và Preview

## Plan

Hai chiều realtime sync trong Page Builder (`/dry/page-builder`), chỉ khi
Code panel đang mở đúng file liên quan (không tự nhảy tab):

1. Hover một phần tử trong preview iframe → highlight đoạn code tương ứng
   trong `Editer` (nếu file đang mở khớp).
2. Di chuyển con trỏ trong `Editer` → highlight phần tử tương ứng trong
   preview.

Kỹ thuật: chèn `data-dry-loc="path:startLine:startCol:endLine:endCol"` vào
mọi JSX host element (`<div>`, không phải component `<Card>`) lúc build
preview, bằng một TS-AST walk + splice string (không dùng TS printer, giữ
nguyên format gốc). Chạy trong Worker riêng để không kéo `typescript` vào
main-thread bundle của admin (giữ đúng quy ước hiện có ở
`worker-protocol.ts`). Chỉ áp dụng cho `buildPreviewSrcdoc` (Page Builder
live preview) - không đụng `buildPage`/`initial-publish.ts`/
`rebuild-affected-pages.ts` (đường publish thật), nên trang live không bao
giờ dính `data-dry-loc`.

Giai đoạn:
1. `instrumentJsxSource` (pure, TS AST) + worker + client + unit test.
2. Gắn vào `buildPreviewSrcdoc` qua flag `inspectorEnabled`, truyền từ
   `PageBuilder.tsx` → `PreviewFrame.tsx` (bật khi Code panel đang mở).
3. Preview hover → code: bridge script mới trong
   `buildPreviewBridgeScript`, `postMessage` lên `PreviewFrame` →
   `PageBuilder` → prop `highlightLoc` xuống `Editer` (chỉ nếu file khớp).
4. Code cursor → preview: `Editer` thêm `onCursorMove`, `PageBuilder`
   truyền `cursorLoc` xuống `PreviewFrame` → `postMessage` vào iframe →
   bridge script tìm phần tử chứa vị trí đó (containment nhỏ nhất) và
   highlight.
5. Edge case: file không khớp thì không sync, không tìm thấy thì ẩn
   highlight, cache danh sách `data-dry-loc` mỗi khi iframe load lại thay
   vì query lại toàn bộ DOM mỗi lần.

Giới hạn đã biết: preview chỉ rebuild sau debounce 400ms có sẵn
(`PreviewFrame.tsx`) khi gõ code - không phải giới hạn mới do tính năng
này gây ra. Di chuyển cursor không gõ thì tức thời (không cần rebuild).

### Cập nhật giữa chừng (cùng ngày)

**Bug tìm thấy khi QA live**: outline trong preview hiện lên rồi tắt ngay.
Nguyên nhân: `previewCursorLoc` dựng object literal mới mỗi render, khiến
effect `postMessage` của `PreviewFrame` refire mỗi khi có hover-update
(re-render không liên quan), gửi lại vị trí cursor CŨ vào iframe và đè lên
highlight hover vừa hiện. Fix: `useMemo` theo đúng line/column thật.

**Feature bổ sung theo yêu cầu**: giữ Shift khi hover/click trong preview
sẽ tắt hẳn cơ chế sync (không highlight/report), để hành vi gốc của thẻ
(hover link, chọn text...) không bị che - cùng convention `dry-vei-shift`
VEI đã dùng.

**Quyết định thay đổi luồng mở file** (theo yêu cầu user, không phải scope
gốc nhưng làm cùng batch vì liên quan trực tiếp): MỌI file `.tsx` (page,
layout, 404/500, component) giờ mở trong `CodePanel` chính (preview panel),
KHÔNG còn mở `FileDialog` nữa - chỉ `.css`/`.md` còn dùng `FileDialog`.
- `BubbleMenu.tsx`: thêm `onSelectComponentFile` cho `.tsx` không phải
  page.tsx (layout/404/500/component); `.css`/`.md` vẫn `onSelectOtherFile`.
- `PageBuilder.tsx`: state mới `openFilePath` (file `CodePanel` đang sửa,
  tách khỏi `activePagePath`/route đang preview). Effect đồng bộ
  `openFilePath` theo `activePagePath` mỗi khi navigate (giữ hành vi cũ:
  duyệt sang trang khác thì code tự theo), nhưng chọn layout/component từ
  menu sẽ "ghim" `openFilePath` cho tới lần navigate kế tiếp - preview vẫn
  giữ nguyên trang đang xem trong lúc đó. `handleCreateFile`/
  `handleRenameFile`/`handleDeleteFile`/`previewChangedCode` cập nhật theo.
  Lợi ích phụ: hover/cursor sync giờ cũng hoạt động khi đang sửa trực tiếp
  1 component/layout (không chỉ page.tsx), vì `highlightLoc`/`cursorLoc`
  giờ so khớp theo `openFilePath` thay vì `activePagePath`.
- `FileDialog.tsx`: bỏ hẳn cột preview/viewport/zoom (dead code thật sự -
  chỉ còn nhận `.css`/`.md`, không file nào trong 2 loại đó có preview).

Đã verify live qua Playwright (đăng nhập thật vào dev server):
data-dry-loc đúng vị trí, hover→code highlight đúng 3 dòng h1, không còn
chớp tắt, Shift chặn đúng, cursor→preview chọn đúng phần tử nhỏ nhất chứa
điểm đó (`<code>` lồng trong `<p>`), click layout.tsx/component mở đúng
CodePanel (preview không đổi), click .css vẫn mở dialog (chồng lên
CodePanel), navigate trong preview kéo CodePanel theo đúng page mới.

### Cập nhật giữa chừng lần 2: CORS lỗi tái phát trong preview iframe

**Không liên quan trực tiếp đến hover/cursor sync** - lỗi CORS
`about:srcdoc` chặn `/node_modules/.vite/deps/preact.js?v=…` đã xuất hiện
lại dù `vite.config.ts` đã có `sandboxPreviewModuleCorsPlugin` từ trước
(comment cũ ghi rõ đây là bug đã từng gặp).

Nguyên nhân thật: fix cũ chỉ hạ `Cache-Control` xuống `no-cache` (lưu +
revalidate qua ETag) cho các request khớp `isSandboxPreviewModuleRequest`.
Nhưng một entry module như `hydrate-built.ts` có `import "preact"` trần,
Vite dev rewrite thành URL kèm hash optimize-deps HIỆN TẠI mỗi lần
transform - còn ETag của chính entry module đó tính theo bytes SOURCE, không
đổi qua một lần re-optimize deps (xảy ra khi lockfile/config đổi, hoặc random
theo log `Re-optimizing dependencies...`). Kết quả: browser nhận 304, replay
lại BODY cũ (đã cache trước đó) - vẫn chứa hash CŨ đã chết trong câu lệnh
import đã rewrite. iframe srcdoc không có socket `@vite/client` HMR nên
không nhận được tín hiệu "hard-reload" Vite thường gửi cho tab thường để tự
hồi phục trường hợp này.

Fix: đổi `Cache-Control` từ `no-cache` sang `no-store` cho toàn bộ request
khớp `isSandboxPreviewModuleRequest` (đè luôn header ghi sau, như bản cũ) -
browser không bao giờ giữ bản cache nào (không ETag, không 304 replay) nữa,
luôn nhận output transform MỚI NHẤT. Dev-only + chỉ áp dụng cho iframe cô
lập nên cái giá hiệu năng không đáng kể. Verify qua curl trực tiếp: request
cả hash hiện tại lẫn hash cũ/giả đều trả `Access-Control-Allow-Origin: null`
+ `Cache-Control: no-store` (kể cả response `504 Outdated Optimize Dep`).

**Lưu ý phát sinh ngoài lề**: `scripts/dev-server.mjs`'s
`closeExistingDevServer` match theo `lsof -ti :PORT`, tức là mọi process có
socket (kể cả CLIENT đã đóng, state CLOSED) trỏ tới cổng đó, không chỉ
process đang LISTEN. Trong phiên debug này, việc restart dev server nhiều
lần đã vô tình gửi SIGTERM cho tổng cộng 3 process không liên quan đang giữ
socket cũ tới cổng 5173 (1 tiến trình Chrome, 2 tiến trình VS Code Helper,
xảy ra ở 2 lần restart khác nhau) - cả 3 đã chết theo. Không phải lỗi của
lần sửa CORS này, nhưng là một lỗi có sẵn trong script, đã xảy ra 2 lần
trong 1 phiên nên rủi ro thật, đáng sửa riêng nếu user đồng ý (nên match
theo LISTEN state, không phải bất kỳ socket nào).

### Cập nhật giữa chừng lần 3: root cause THẬT của lỗi CORS tái phát

Lần sửa "no-store" ở trên là cải thiện hợp lý nhưng **không phải root cause
thật** - kiểm tra lại kỹ hơn (so `_metadata.json`'s `browserHash` - giá trị
thực sự được nhúng vào query `?v=…` - với hash bị lỗi user báo) phát hiện:
`browserHash` KHÔNG hề đổi, server luôn trả đúng
`preact.js?v=aeffcb54`/200/CORS header hợp lệ mọi lúc test qua curl trực
tiếp. Tức là server chưa từng sai ở thời điểm test.

Root cause thật: **cache phía TRÌNH DUYỆT của user**, không phải server.
`/node_modules/.vite/deps/*.js` mặc định Vite gắn
`max-age=31536000, immutable`. Nếu request ĐẦU TIÊN cho đúng URL này (trong
tab đang test) xảy ra TRƯỚC KHI `sandboxPreviewModuleCorsPlugin` từng tồn
tại (hoặc trước khi nó match đúng URL đó), trình duyệt lưu bản KHÔNG có
CORS header với cờ `immutable` - và với `immutable`, trình duyệt sẽ KHÔNG
BAO GIỜ hỏi lại server nữa (không revalidate, không 304) cho tới khi hết
hạn 1 năm. Không có cách nào từ phía server "sửa" ngược một bản cache đã bị
đánh dấu immutable như vậy - `no-cache` hay `no-store` chỉ ảnh hưởng
response TỪ THỜI ĐIỂM ĐƯỢC ÁP DỤNG trở đi, vô nghĩa với request mà trình
duyệt còn chẳng buồn gửi lên server.

Fix thật: xoá `node_modules/.vite/deps` rồi khởi động lại dev server, ép
Vite re-optimize sinh `browserHash` HOÀN TOÀN MỚI
(`aeffcb54` → `719b2b75`). URL cũ bị bỏ rơi hẳn (giờ trả `504 Outdated
Optimize Dep`, nhưng có kèm CORS header đúng nếu ai đó vẫn lỡ gọi tới) -
quan trọng hơn: preview HTML sinh ra từ giờ trỏ tới hash MỚI, một URL trình
duyệt của user CHƯA TỪNG cache trước đó, nên tự động bypass hoàn toàn vùng
cache bị nhiễm mà không cần user tự tay xoá cache trình duyệt.

Verify: curl hash mới → 200 + CORS header đúng; Playwright load lại
`/dry/page-builder` → 0 lỗi/warning console kể từ lần điều hướng.

**Vẫn tái phát sau đó (user báo lại, kèm `net::ERR_FAILED` - đúng hash
`aeffcb54` quay lại)**: lần "xoá deps + restart" ở trên chỉ che triệu chứng
tạm thời, KHÔNG sửa root cause thật. So sánh kỹ hơn: `preact` (bare
`import ... from "preact"`) được `src/main.tsx` - entry thật của admin -
import tĩnh, nên Vite ĐÃ pre-bundle nó từ đầu; nhưng `browserHash` là MỘT
mã chung cho TOÀN BỘ thư mục pre-bundle, không phải per-package - nên chỉ
cần một dependency KHÁC bị phát hiện muộn cũng đủ bump lại hash của
`preact` dù bản thân nó không đổi gì.

Root cause thật (structural, không phải cache): 3 entry file preview iframe
dùng ở dev (`assets.ts`: `HYDRATE_ENTRY_HREF=/src/apps/hydrate-client.ts`,
`EDIT_LAUNCHER_HREF=/src/apps/edit-launcher.ts`,
`HYDRATE_BUILT_HREF=/src/apps/hydrate-built.ts`) chỉ được request qua URL
thô TỪ BÊN TRONG iframe cô lập (`page-preview-engine.ts` build srcdoc) -
không hề nằm trong đồ thị `import` tĩnh nào Vite crawl được từ
`index.html`/`main.tsx`. Nên dependency riêng của nhánh preview (mọi thứ
`hydrate-built.ts` kéo theo mà admin's own bundle không chạm tới) chỉ được
Vite phát hiện MUỘN, đúng lúc runtime, kích hoạt re-optimize giữa phiên -
bump `browserHash` chung, và vì iframe không có socket `@vite/client` HMR
nên không nhận được tín hiệu tự reload như tab thường - y hệt pattern
`isomorphic-git` đã note sẵn trong `optimizeDeps.include` (dynamic
`import()` không được crawl tĩnh), chỉ khác object bị "phát hiện muộn" lần
này là CẢ MỘT NHÁNH ENTRY riêng, không phải 1 package lẻ.

Fix thật (structural, `vite.config.ts`): thêm
`optimizeDeps.entries: ["index.html", "src/apps/hydrate-client.ts",
"src/apps/edit-launcher.ts", "src/apps/hydrate-built.ts"]` - Vite crawl
CẢ 4 gốc này ngay từ cold start (lưu ý `entries` THAY THẾ hoàn toàn crawl
mặc định index.html-only nên phải liệt kê lại `"index.html"`), pre-bundle
trọn vẹn closure của nhánh preview cùng lúc với admin - không còn phát
hiện muộn giữa phiên, không còn bump hash, không còn race.

Verify: `browserHash` ổn định qua 5 request liên tiếp tới cả 2 file dùng
bare `import "preact"` (`media-src-hook.ts`, `vei-marker-hook.ts`) - cùng
1 hash mỗi lần; Playwright load lại `/dry/page-builder` 3 lần liên tiếp
(fresh navigation mỗi lần) → 0 lỗi CORS/preact ở cả 3 lần.

**Sự cố ngoài lề #3 - đã fix**: trong lúc restart lần này phát hiện có 1
process VS Code Helper đang giữ kết nối ESTABLISHED (không phải CLOSED như
2 lần trước) tới cổng 5173 - nếu restart tiếp mà không sửa
`closeExistingDevServer` thì gần như chắc chắn sẽ kill nhầm process đang
hoạt động thật. Đã sửa `scripts/dev-server.mjs`: đổi `lsof -ti :$port`
thành `lsof -ti :$port -sTCP:LISTEN` (lọc theo state LISTEN thay vì bắt
mọi socket tham chiếu tới port) - restart sau đó xác nhận chỉ kill đúng
process dev server cũ, VS Code Helper (72807) vẫn sống nguyên.

## Status

Hoàn thành, đã verify live qua 3 lần reload liên tiếp không lỗi.
`bun run typecheck` sạch, `bun run test` 1448 tests pass (150 files). CORS
fix ban đầu (no-store) vẫn giữ (đúng hướng, không sai) nhưng root cause
thật là `optimizeDeps.entries` thiếu nhánh preview - đã bổ sung.
`closeExistingDevServer` cũng đã fix (chỉ match LISTEN, không bắt nhầm
process khác) sau khi gây sự cố 3 lần trong 1 phiên.

## Speed

Bắt đầu và hoàn thành 2026-08-18, làm liên tục theo yêu cầu user (không
dừng để hỏi giữa chừng), gồm cả yêu cầu bổ sung (bugfix, shift, đổi luồng
mở file) phát sinh trong lúc QA.

## Bổ sung 2026-08-20 - hover không còn tự scroll code

Yêu cầu user: "tại preview khi hover vào 1 thành phần không tự ý scroll đến
file code, khi click vào mới scroll đến".

Trước đó `Editer`'s `applyInspectorHighlight` luôn gọi `scrollIntoView` cho
mọi `highlightLoc`, mà `highlightLoc` được nuôi bằng hover - nên chỉ quét
chuột ngang qua preview là editor bị giật liên tục.

Sửa:

- `Editer.tsx`: `highlightLoc` thêm cờ `reveal?: boolean`; chỉ khi
  `reveal` mới `scrollIntoView`. Highlight (tô nền dòng) vẫn chạy cho cả
  hover lẫn click - phần đó không đổi.
- `CodePanel.tsx`: chỉ nới kiểu prop, truyền thẳng như cũ.
- `PageBuilder.tsx`: thêm state `inspectorRevealLoc`, set trong
  `handleInspectorClick` (click preview -> mở file). `highlightLoc` giờ là
  `useMemo` từ `inspectorRevealLoc ?? inspectorHoverLoc`, `reveal` chỉ true
  khi loc đang dùng là loc của click. Bọc `onInspectorHover` bằng
  `handleInspectorHover` để hover sang phần tử KHÁC thì xoá
  `inspectorRevealLoc` (bridge script chỉ báo hover khi đổi phần tử, nên
  click xong không bị hover kế tiếp xoá nhầm).
  `useMemo` là bắt buộc ở đây, cùng lý do đã ghi cho `previewCursorLoc`:
  effect của `Editer` key theo reference, object literal mới mỗi render sẽ
  scroll lại liên tục.

## Bổ sung 2026-08-20 - bỏ bubble Magic trùng trong iframe VEI

Yêu cầu user: magic chat của VEI không cần hiện trong iframe, vì trang
page-builder đã có sẵn nút đó rồi - hiện thêm là dư ra 1 nút.

`MagicChat.tsx` (entry editor) giờ ẩn `.magic-chat-bubble` khi
`veiFrame === true` (`?_vei=1`, tức chỉ trong iframe của
`VeiEntryFrame.tsx`). Component vẫn mount nguyên vẹn - `rewriteFnRef`
("Rewrite selection" của RichText) và panel không đổi, panel chỉ mở từ
rewrite thay vì từ click bubble khi đang ở trong frame. Bubble của chính
trang page-builder (`PageSourceMagicChat`) không liên quan, vẫn hiện.

Bổ sung cùng ngày theo yêu cầu tiếp theo của user ("ẩn luôn nút preview ở
veiFrame"): nút **Preview** (diff dialog) trong header cục bộ của
`ContentEntryEditor.tsx` cũng ẩn khi `veiFrame` - panel này nằm ngay cạnh
preview live của Page Builder, vốn đã hiện đúng những sửa đổi đang gõ
(`vei:input` -> `PreviewPatchDetail`), nên dialog diff trong iframe hẹp chỉ
là trùng lặp. Cùng lý do với nút Save vốn đã ẩn sẵn ở đó từ trước.
`EntryPreviewDialog` vẫn mount, chỉ là không còn trigger trong chế độ này -
kéo theo Reset-từng-field (chỉ có trong dialog đó) không với tới được khi ở
trong iframe; "Clear all" cho entry mới vẫn còn.

Verify: `bun run typecheck` sạch, `bun run test` 1450 pass (150 files).

### Không verify được bằng e2e (lỗi có sẵn, không do thay đổi này)

Định chạy `e2e/page-builder*.spec.ts` để kiểm chứng thì phát hiện toàn bộ
nhóm spec này ĐANG FAIL sẵn trên master sạch: `openBuilder` timeout chờ
`.dock`, trang chỉ hiện toast "HTTP Error: 401 Unauthorized". Đã stash hết
sửa đổi local và chạy lại 1 test → vẫn fail y hệt, nên không liên quan
thay đổi ở trên.

Root cause (drive Chromium thật vào `bun scripts/e2e-server.mjs` và log mọi
response >= 400): request fail là
`GET /dry/api/git/info/refs?service=git-upload-pack`. Page Builder đang ở
chế độ GIT chứ không phải chế độ HTTP pages-source như comment đầu
`e2e/page-builder-utils.ts` mô tả - `usingGit` = `gitPhase !== "unconfigured"`
(`use-page-builder-source.ts:200`), mà git state lấy từ singleton
`githubSync` trong DB, đúng cái mà `e2e/global-setup.ts` PUT vào (repo
`e2e-org/e2e-repo` + token giả) chỉ để bỏ qua redirect `/dry/github-setup`.
Việc `scripts/e2e-server.mjs` blank `GITHUB_REPO`/`GITHUB_BRANCH`/
`GITHUB_PAT_KEY` không còn tắt được git nữa → builder đi clone repo giả →
401 → app không mount.

Chưa sửa (ngoài phạm vi yêu cầu). Muốn e2e nhóm này sống lại thì phải tách
"dismiss gate github-setup" khỏi "bật git mode" trong global-setup.
