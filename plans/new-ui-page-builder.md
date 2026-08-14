# Xây dựng UI Page Builder

> Ý tưởng gốc giữ nguyên văn ngay dưới đây - đừng sửa mục đó. Phần "Kế hoạch
> đã hoàn thiện" sau nó là bản đã kiểm tra lại với code thật, chốt quyết định
> cho từng chỗ mơ hồ - sửa phần đó khi kế hoạch đổi.

## Ý tưởng gốc (nguyên văn)

Xây dụng UI Page Builder: tôi cần thêm chế độ hiển thị để tốt hơn cho trang page editer
- page editer vẫn giữ lại như một cơ chế tuỳ chọn cho người dùng chuyên nghiệp (hoặc sẽ xoá sau nếu cần vì vi phạm DRY)
- trang riêng hoàn toàn tách biệt nhưng cũng cơ chế hoạt động chỉ khác UI với page editer
- trang /dry/page-builder?path=...
- Nguyên trang là iframe chiếm 100% screen của brower có cùng chức năng với preview
- có 1 nút foat ở dưới bên phải giống vị trí và UI của VEI - tên là Toolbar
- Menu page:
    - hiện popup bong bóng bên trái là các tab: page, component, style, md tương ứng
    - ở page khi nhấn vào sẽ đi đến trang preview đó - có thể mở kéo thả panel bên phải (giống VEI), mở ra để edit code
    - ở các file khác, nhấn vào sẽ mở dialog lg 1 hoặc 2 page (có preview hay không) để hiện code và chỉnh sửa code trên đây, có nút save, reset đầy đủ
    - tại trang preview này menu toolbar có thể bật tắt chế độ VEI (không giống 100% chỉ tương đồng một vài chức năng):
        - bật sẽ hiện các cái đánh mấu của data-dry (thêm css và js tương ứng cho phần này vào trang)
        - khi click vào thì thay cho code editer sẽ hiện ra trang edit entry/singleton tương ứng
        - edit entry/sington hoặc code thì preview sẽ đổi theo

Yêu cầu: cấu trúc phải chia rõ ràng nhiều file để dễ bảo trì
Mông muốn: hợp nhất chức năng VEI và page-code-editer vào 1 trang để dễ quản lý, bảo mật an toàn hơn cho trang của khách vẫn lai
Không cần thêm css js thừa riêng cho chế độ VEI phụ vụ việc đã đăng nhập

---

## Kế hoạch đã hoàn thiện

### Bối cảnh - phần khó nhất đã có sẵn, không phải xây từ đầu

Đọc code thật (`PageEditor.tsx`, `page-build.ts`, `dry-reader-http.ts`,
`vei-marker-hook.ts`, `apps/vei-live-refresh.ts`, `apps/vei/Dock.tsx`,
`pages/vei/bridge.ts`) cho thấy **2 nửa của ý tưởng này đã dùng chung một lõi
render, chỉ khác nơi gọi**:

- `PageEditor.tsx`'s live preview (`page-build.ts:514 buildPage()`) build 1
  trang qua `configureHttpDryReader` + `resolveMatchToVNode`, render ra
  `result.html`, nhét vào `<iframe srcdoc>`. Đây chính là "trang riêng ...
  cùng chức năng với preview" mà ý tưởng gốc muốn - **dùng lại `buildPage()`
  y nguyên**, không viết pipeline build mới.
- `HttpDryReaderConfig` (`dry-reader-http.ts:49-85`) **đã có sẵn field
  `vei?: DryVeiContext`** và `markOrInert()` (dòng 120-133) đã biết box
  chuỗi thật khi field đó có mặt - hiện tại `buildPage()` không set field
  này (luôn render "inert", đúng cho preview tĩnh/publish thật), nhưng chỗ
  nối đã có, chỉ cần thêm 1 field optional vào `PageBuildInput`.
- `apps/vei-live-refresh.ts` (VEI live site, đã verify chạy thật 2026-08-14)
  **chính là bằng chứng sống** rằng đúng pipeline này (`buildPage`-style
  build + `configureHttpDryReader({ vei })` + `installVeiMarkerHook()`
  (`vei-marker-hook.ts:62`)) render ra HTML có `data-dry` thật, click được -
  file đó tự ghi trong doc comment: "the same eval-and-render pipeline ...
  proven (via `buildPage()`, `PageEditor.tsx`'s live preview)". Tức là chế
  độ VEI trong Page Builder **không phải tính năng mới**, chỉ là gọi đúng
  cái `vei-live-refresh.ts` đang gọi, từ trong `/dry/page-builder` thay vì
  từ trang public.
- `apps/vei/Dock.tsx` đã có sẵn `EditButtonDock`/`EditingDock` (nút nổi góc
  dưới phải, đúng UI/vị trí ý tưởng gốc muốn cho "Toolbar") **và**
  `ModeToggle`/`EditorMode = "dialog" | "panel"` - đúng "kéo thả panel bên
  phải (giống VEI)" ý tưởng gốc mô tả, không cần thiết kế lại.
- `pages/vei/bridge.ts` + route `${path}/content/:typeSlug/:id?_field=...&_vei=1`
  đã là "trang edit entry/singleton" mở trong iframe khi click field - dùng
  lại nguyên, không tạo route mới.
- `PAGES_SOURCE_ROOTS` (`source-roots.ts:53-58`) đã đúng 4 tab
  page/component/style/md ý tưởng gốc liệt kê.
- `PAGE_BUILDER_RESOURCE_ID` (`permissions.ts:69`, nhãn "Page Builder") đã
  là permission gate chung cho Page Editor + Page Build + MCP page-source
  write - dùng lại, không tạo permission mới.
- `PageEditor.tsx` (dòng 2165-2174) **đã tự stripping** thẻ
  `<script src="${veiOverlayHref}">` ra khỏi HTML preview trước khi nhét vào
  iframe - tiền lệ có sẵn cho đúng yêu cầu "không thêm css/js thừa": preview
  không cần nạp bundle `overlay.ts` độc lập.

### Quyết định đã chốt

1. **Route**: `${path}/page-builder`, query `?path=<site route pathname>`
   (vd `?path=/blog/hello`, KHÔNG phải đường dẫn file nguồn) - dùng
   `route-manifest.ts`'s `matchSourceRoute`/`buildManifestRouteTree` (đã
   isomorphic, `vei-live-refresh.ts` đang dùng y hệt) để suy ra
   `page.tsx`/layout chain từ pathname. Trang `component`/`style`/`md` không
   có route riêng nên không đi qua `?path=` - chỉ mở qua dialog (quyết định
   #6).

2. **Preview = `buildPage()` dùng lại, không pipeline mới.** Toàn màn hình
   `<iframe srcdoc>` (không phải panel scale-xuống như `PageEditor.tsx`),
   dùng lại nguyên `buildPreviewBridgeScript()`'s cơ chế chặn click
   `<a href>` + `Cmd/Ctrl+S` postMessage - chỉ đổi tỷ lệ/khung nhìn.

3. **Chế độ VEI = `buildPage({ vei })` + `installVeiMarkerHook()`, KHÔNG nạp
   bundle `overlay.ts` riêng.** Thêm 1 field optional
   `vei?: DryVeiContext` vào `PageBuildInput` (`page-build.ts:406`), thread
   vào `dryConfig.vei` (dòng ~525) và gọi
   `installVeiMarkerHook(runtime.options)` (mirror
   `vei-live-refresh.ts:260`) khi field này có mặt. `canUpdate` dựng thẳng
   từ `store/auth.ts`'s `authState`/`canAccess` đã có sẵn trong session admin
   đang chạy Page Builder - **không cần fetch `/api/auth/session` riêng**
   như `vei-live-refresh.ts` phải làm (nó chạy ngoài trang public, không có
   session admin sẵn trong tay).
   Script bơm vào `srcdoc` chỉ là bản MỞ RỘNG của
   `buildPreviewBridgeScript()` hiện có (thêm 1 nhánh: click vào phần tử có
   `data-dry` → `postMessage` ref đó ra ngoài) - không phải build/nạp thêm
   1 bundle JS độc lập nào. Đây là cách thoả đúng yêu cầu "Không cần thêm
   css js thừa riêng cho chế độ VEI".

4. **Toolbar nổi = `Dock.tsx` dùng lại** (`EditButtonDock`/`EditingDock`,
   `ModeToggle`), gắn trực tiếp trong `PageBuilder.tsx` (component Preact
   thật trong SPA admin, không phải mount qua Shadow DOM như `overlay.ts`
   phải làm cho trang public không tin cậy được - ở đây đã ở trong admin
   app rồi nên không cần cách ly đó).

5. **Bubble menu trái = đúng `PAGES_SOURCE_ROOTS`** (page/component/style/md),
   click 1 tab bung popup danh sách file trong root đó (dùng lại
   `ComponentTreePanel`/`entriesForSourceRoot` đã có).

6. **Tab "Page"**: 2 lối vào `path=`, không phải 1.
   - **Đã có `path=` cụ thể** (deep-link, hoặc click `<a>` trong chính
     preview qua bridge script): `matchSourceRoute(manifest, pathname)`
     (`route-manifest.ts:70`) khớp THẲNG kể cả route động - nó dùng chung
     `matchRoute` với request thật, tự suy `params.slug` từ vị trí segment,
     KHÔNG cần chọn bản ghi mẫu trước. `?path=/blog/hello` → `entryPath:
     "pages/blog/[slug]/page.tsx"`, `params: { slug: "hello" }` ngay.
   - **Bấm vào 1 FILE template trong bubble menu** (vd chính
     `blog/[slug]/page.tsx`, không phải 1 URL cụ thể): chưa có `slug` nào
     cả nên mới cần hỏi trước - tái dùng đúng logic
     `PageEditor.tsx:1853-1869` (thử khớp static bằng `staticPagePaths` +
     so `entryPath`, không khớp thì rơi vào `listDynamicPageTemplates` +
     `fetchPreviewEntries`/`PreviewEntryRef` chọn 1 bản ghi), từ đó ghép ra
     1 `path=` cụ thể rồi đi tiếp như nhánh trên.
   Panel code bên phải: kéo-thả bằng `useResizablePanel` (đã dùng 3 chỗ
   trong `PageEditor.tsx`), chứa `Editer` cho `page.tsx` đang preview.

7. **Tab component/style/md**: click 1 file → `<dialog class="lg">`, 1 cột
   (style/md - không preview có ý nghĩa) hoặc 2 cột (component - dùng lại
   `buildComponentPreviewSource`/`previewStageStyle` PageEditor's Component
   tab đã có). Save/Reset dùng lại đúng luồng draft
   (`page-source-draft-db.ts`) + write API
   (`pages-source-http-api.ts`) PageEditor đang dùng - viết thẳng vào
   `pagesSourceStorage` ngay khi Save (không phải staged-apply kiểu content
   type), y như hành vi hiện tại.

8. **Click `data-dry` khi VEI bật**: mở lại đúng iframe entry editor có sẵn
   (`${path}/content/:typeSlug/:id?_field=...&_vei=1`), dùng
   `Dock`'s `ModeToggle` để chọn dialog giữa màn hình hay panel kéo-thả bên
   phải - style/kích thước khác `?_vei=1` hôm nay chỉ ở chỗ nó được mở TỪ
   Page Builder (postMessage nội bộ), không phải từ overlay Shadow DOM trên
   trang public. Preview cập nhật theo qua đúng `dry:field-input` bridge
   (`field-events.ts`) `vei.md` mục "Preview = patch DOM trực tiếp" đã tả -
   patch DOM trực tiếp trong `srcdoc` iframe, không build lại.

9. **Phân quyền**: route `/dry/page-builder` gate bằng
   `PAGE_BUILDER_RESOURCE_ID` y hệt Page Editor/Page Build (nav item mới
   trong `DryLayout.tsx`, cùng `permissionResourceId`). Việc field nào THỰC
   SỰ có marker `data-dry` khi bật VEI vẫn theo đúng `canUpdate` per-type
   hiện có (`dry-populate.ts:44`) - không đổi: 1 admin có quyền Page Builder
   nhưng không có quyền update `blog` vẫn thấy trang/code bình thường,
   chỉ không thấy field `blog` clickable.

10. **Tách "engine" dùng chung khỏi `PageEditor.tsx` TRƯỚC khi viết Page
    Builder** - trả lời thẳng lo ngại DRY ở mục 2 ý tưởng gốc, và đúng yêu
    cầu "chia rõ nhiều file". `PageEditor.tsx` hiện 2773 dòng, tự nhận trong
    doc comment của nó là "a near-clone of `PageComponents.tsx`" (file đó
    giờ không còn tồn tại riêng - đã bị merge/xoá) - **không lặp lại đúng
    sai lầm đó lần nữa** bằng cách copy-paste `PageEditor.tsx` thành
    `PageBuilder.tsx`. Tách ra hook/module dùng chung cho cả 2 trang:
    - Tree + draft state (`getAllPageSourceDrafts`/`putPageSourceDraft`/
      `deletePageSourceDraft`, `hydrateInitialTree`).
    - Save/Reset 1 file (viết `pagesSourceStorage`, xoá draft, refresh cache).
    - Gọi `buildPage()` + inject bridge script + xử lý
      `PREVIEW_NAVIGATE_MESSAGE`/`PREVIEW_SAVE_MESSAGE`.
    - Route pathname ↔ `page.tsx`/layout chain (`matchSourceRoute` wrapper),
      kể cả nhánh `[param]` + `fetchPreviewEntries`.
    Nếu tách toàn bộ tốn quá nhiều thời gian, **có thể cắt**: chỉ tách phần
    "gọi `buildPage()` + bridge script" (phần Page Builder chắc chắn cần,
    và là phần dễ lẫn lộn/khác bản nhất nếu viết trùng 2 lần), để tree/draft
    tạm thời viết riêng cho Page Builder ở bản đầu - ghi rõ nợ kỹ thuật này
    lại nếu cắt.

11. **Gộp VEI (trang public) vào Page Builder là GIAI ĐOẠN 2, làm SAU khi
    Page Builder build xong + verify chạy thật** - không xoá
    `apps/vei/overlay.ts`/`vei-live-refresh.ts` cùng lúc với việc xây tính
    năng mới (rủi ro cao nếu 1 PR vừa thêm vừa xoá 1 tính năng đã production-
    verified). Khi tới giai đoạn đó, việc xoá `apps/vei/overlay.ts`,
    `overlay-styles.ts`, `apps/vei-live-refresh.ts`, route `/vei/enter`,
    cookie `dry_admin=1`/`dry_vei`, và bỏ hẳn thẻ
    `<script src="${veiOverlayHref}">` khỏi `build-document.ts:179` (hiện
    nhúng KHÔNG điều kiện vào MỌI trang, kể cả khách vãng lai) **chính là
    cái làm được "bảo mật an toàn hơn cho trang của khách vãng lai"** ý
    tưởng gốc muốn - khách vãng lai không còn tải/chạy 1 script dò cookie
    admin nào nữa, không còn cookie gợi ý `dry_admin=1` nào được đặt.
    `Dock.tsx`/`bridge.ts` (đang ở `apps/vei/`, `pages/vei/`) được cả 2 nơi
    dùng chung trong lúc chuyển tiếp - chỉ di chuyển file khi giai đoạn 2
    xoá `overlay.ts`, tránh dọn thư mục 2 lần.

12. **Page Editor giữ nguyên route/nav, không xoá ở lần này** (đúng mục 2 ý
    tưởng gốc: "vẫn giữ lại ... cho người dùng chuyên nghiệp"). Thêm 1 nút
    "Mở trong Page Editor" trong panel code của Page Builder (mở
    `${path}/page-editor?path=...` đúng file đang sửa) cho ai cần công cụ
    đầy đủ (Magic Chat, GitHub sync/restore, System files tab - những thứ
    Page Builder KHÔNG làm lại ở bản đầu, xem "Không làm ở lần này"). Việc
    xoá Page Editor thật sự chỉ nên xét lại sau khi Page Builder đã chạy đủ
    lâu để biết mọi luồng của nó (Magic Chat, GitHub) có thật sự cần "nhân
    bản" sang Page Builder hay không.

### File - tạo mới

| File | Việc |
| --- | --- |
| `src/pages/PageBuilder.tsx` | Route component - lazy trong `App.tsx`. Composition root mỏng: đọc `?path=`, dựng preview + toolbar + bubble menu, KHÔNG chứa logic build/draft (nằm ở engine tách ra, mục 10). |
| `src/page-components/page-builder/PreviewFrame.tsx` | `<iframe srcdoc>` toàn màn hình, gọi engine's `buildPage()` wrapper, nhận `postMessage` navigate/save/vei-click. |
| `src/page-components/page-builder/Toolbar.tsx` | Bọc `Dock.tsx`'s `EditingDock`, thêm nút bật/tắt VEI mode + nút mở bubble menu. |
| `src/page-components/page-builder/BubbleMenu.tsx` | Popup bên trái: 4 tab `PAGES_SOURCE_ROOTS`, danh sách file mỗi tab (dùng lại `entriesForSourceRoot`). |
| `src/page-components/page-builder/CodePanel.tsx` | Panel kéo-thả bên phải (tab Page) - `Editer` + Save/Reset, dùng `useResizablePanel`. |
| `src/page-components/page-builder/FileDialog.tsx` | `<dialog class="lg">` 1/2 cột cho component/style/md - `Editer` (+ preview cột 2 khi là component). |
| `src/page-components/page-builder/vei-bridge-script.ts` | Bản mở rộng của `buildPreviewBridgeScript()`: thêm nhánh click `[data-dry]` → `postMessage` ref ra ngoài iframe. |
| `src/page-components/page-source-editor-engine.ts` | Engine dùng chung tách từ `PageEditor.tsx` (mục 10) - tree/draft state, save/reset 1 file, gọi `buildPage()`, route↔source resolution. `PageEditor.tsx` VÀ `PageBuilder.tsx` cùng import. |

### File - sửa

| File | Việc |
| --- | --- |
| `src/page-components/page-build.ts` | `PageBuildInput` thêm `vei?: DryVeiContext`; `buildPage()` thread vào `dryConfig.vei` + gọi `installVeiMarkerHook(runtime.options)` khi có mặt (mirror `apps/vei-live-refresh.ts:260`). |
| `src/pages/PageEditor.tsx` | Đổi các đoạn tree/draft/build dùng chung sang import từ `page-source-editor-engine.ts` thay vì giữ logic riêng (mục 10) - hành vi hiện tại không đổi. |
| `src/routers/App.tsx` | Thêm `<Route path={`${path}/page-builder`} component={PageBuilder} />` (lazy, cùng nhóm với `PageEditor`/`PageBuild`). |
| `src/components/DryLayout.tsx` | Thêm nav item "Page Builder" section "System", `permissionResourceId: PAGE_BUILDER_RESOURCE_ID`, đặt trên "Page Code Editor" trong danh sách (tín hiệu đây là lối vào chính). |

### Thứ tự thực thi (mỗi bước verify được)

1. **Tách engine** (mục 10) khỏi `PageEditor.tsx`, hành vi Page Editor không
   đổi 1 dòng UI nào. *Verify*: test hiện có của Page Editor vẫn xanh, QA
   tay 1 lượt save/reset/preview như cũ.
2. **`PageBuildInput.vei` + `installVeiMarkerHook`** trong `page-build.ts`.
   *Verify*: gọi `buildPage({ ..., vei: fakeContext })` trong 1 test, thấy
   `data-dry` xuất hiện trong `result.html` - `dry-reader-http.test.ts` đã
   có tiền lệ test `markOrInert`, viết test tương tự ở tầng `buildPage()`.
3. **`PageBuilder.tsx` khung sườn**: route + `?path=` + `PreviewFrame` gọi
   `buildPage()` KHÔNG `vei` (preview thường trước). *Verify*: mở
   `/dry/page-builder?path=/`, thấy trang thật render trong iframe toàn màn
   hình, click link điều hướng đổi `?path=` đúng.
4. **`Toolbar` + `BubbleMenu` + `CodePanel`**: click file trong tab Page mở
   panel phải sửa code, Save/Reset hoạt động qua engine chung.
   *Verify*: sửa `page.tsx`, Save, reload thấy thay đổi (giống Page Editor).
5. **`FileDialog`** cho component/style/md. *Verify*: sửa 1 style, Save,
   trang preview (rebuild) phản ánh đúng.
6. **VEI mode**: toggle bật → `PreviewFrame` build lại với `vei`, script mở
   rộng bind click `[data-dry]` → mở iframe entry editor có sẵn (dialog/
   panel), sửa field → `dry:field-input` patch DOM preview trực tiếp (không
   build lại). *Verify*: bật VEI, click 1 field text, sửa trong dialog,
   thấy preview đổi ngay không cần Save; Save xong reload preview thường
   thấy giá trị mới.

Giai đoạn 2 (riêng, sau khi bước 1-6 verify chạy thật):

7. Xoá `apps/vei/overlay.ts`, `overlay-styles.ts`, `apps/vei-live-refresh.ts`,
   route `/vei/enter`, cookie `dry_admin=1`/`dry_vei`, thẻ
   `<script src="${veiOverlayHref}">` khỏi mọi trang build/publish thật.
   *Verify*: build 1 trang thật, `curl` HTML không còn thẻ script VEI nào;
   admin vẫn sửa được nội dung/code, chỉ qua `/dry/page-builder`.

### Cạm bẫy / rủi ro cần kiểm chứng

1. **`srcdoc` iframe = origin kế thừa từ parent** (không phải origin rỗng)
   khi KHÔNG có `sandbox` - `PageEditor.tsx`'s preview hiện tại đã dựa vào
   điều này cho `postMessage`, nên đã được chứng minh chạy đúng; giữ nguyên
   giả định, không thêm `sandbox`.
2. **`installVeiMarkerHook` gắn vào `runtime.options` của Preact instance
   RIÊNG cho trang được build** (không phải Preact của chính SPA admin) -
   `vei-live-refresh.ts:260` đã làm đúng việc này; `buildPage()` cần gọi nó
   trên đúng `PageBuildPreactRuntime` truyền vào, không phải
   `preact/options` của module admin đang chạy (2 instance khác nhau, patch
   nhầm instance = marker không xuất hiện, im lặng không lỗi).
3. **`canUpdate` dựng từ session admin đang chạy Page Builder** phải cùng
   logic per-type permission `vei-live-refresh.ts:164` dùng (không phải tự
   viết lại) - lệch logic ở đây nghĩa là field lẽ ra clickable lại không,
   hoặc ngược lại lộ field không có quyền sửa.
4. **Route động `[slug]`**: chỉ cần entry-picker
   (`fetchPreviewEntries`) khi vào từ bubble menu bằng cách bấm thẳng FILE
   template (`blog/[slug]/page.tsx`) - lúc đó chưa có `slug` nào để build.
   Khi đã có `?path=/blog/hello` cụ thể (deep-link, hay click `<a>` trong
   preview) thì **không cần picker** - `matchSourceRoute` tự khớp
   `params.slug = "hello"` thẳng, y hệt 1 request thật. Đừng nhầm lẫn 2
   nhánh này khi code (mục 6) - bắt picker chạy cả khi đã có `path=` cụ thể
   là làm thừa 1 bước không cần thiết.
5. **Dialog entry editor mở từ Page Builder dùng `?_vei=1`** - `isVeiFrame()`
   (`pages/vei/bridge.ts`) check `window.parent !== window`, đúng cho cả 2
   trường hợp (mở từ overlay Shadow DOM trên trang public, hoặc mở từ
   `PageBuilder.tsx` trong SPA admin) - không cần sửa điều kiện đó, nhưng
   PHẢI verify tay: dialog mở từ trong admin SPA (thay vì từ trang public
   sandbox-hoá) có vô tình lấy nhầm theme/route context của chính admin
   không (vd sidebar/topbar `DryLayout` lọt vào do quên bọc `Chrome`).

### Không làm ở lần này

- Magic Chat / AI trong Page Builder (Page Editor giữ vai trò đó, nút "Mở
  trong Page Editor" là lối thoát - mục 12).
- GitHub sync/restore, System (core styles) tab - vẫn chỉ ở Page Editor.
- Xoá `apps/vei/**` hay Page Editor - cả 2 đều là giai đoạn sau, không gộp
  vào PR xây Page Builder (mục 11, 12).
- "Build/Publish" trang thật (`publishBuiltPage`) từ trong Page Builder -
  Save ở đây chỉ ghi `pagesSourceStorage` (như Page Editor hôm nay), publish
  thật vẫn qua `PageBuild.tsx` cho tới khi có nhu cầu rõ ràng gộp luôn nút
  Build vào toolbar này.
- Xoá bớt component/repeatable marker trong VEI mode (giữ đúng giới hạn v1
  đã chốt ở `plans/vei.md` mục "Không làm ở lần này": không marker cho
  `relation`/thêm-xoá item repeatable trên preview).

### Quy mô thật

Ước lượng: 8 file mới + 4 file sửa cho phần chính (mục "File - tạo mới/sửa"),
cộng phần tách engine khỏi `PageEditor.tsx` (mục 10) là việc refactor riêng,
không nhỏ (file nguồn 2773 dòng). Cắt được nếu cần thời gian: bỏ VEI mode
(bước 6) trước, Page Builder vẫn dùng được ở chế độ "chỉ code" (bước 1-5) -
đúng vai trò tối thiểu ý tưởng gốc mô tả (UI hiển thị tốt hơn cho page
editor); thêm VEI mode sau như 1 lần lặp riêng.
