# Xây dụng App router là tham chiếu page như NextJS

## Ý tưởng gốc

- hệ thống dùng preact
- thư mục chủ đích là src/apps/pages
- tên thư mục ứng với tên của path
- trong thư mục có các file
    - layout.tsx: luôn gọi lòng nhau
    - page.tsx: chứa code hiện ra page
- file có thể là [..path] hoặc [slug]/page.tsx để nhận được slug từ Dry.params (Dry là object tự tạo để trả các biến)
- các file chạy ở server là async functions (đọc content qua `dry()` là
  async - xem `plans/reader.md`); render bằng `renderToStringAsync`
- khi viết xong sẽ build thành file .html, .js (dùng hydrate tải lazy về sau để tái tạo app react), file .css dùng chung
- trên dev có thể vào xem trực tiêp live preview qua vite
- hệ thống dùng tailwindcss v4 cho riêng thư mục src/apps

(Giữ nguyên văn bản gốc ở trên - phần "Dry.params"/`renderToStringAsync`
đã được sửa lại trong kế hoạch triển khai bên dưới, xem "Quyết định kiến
trúc" #1 và #3.)

## Trạng thái (2026-08-05)

**Giai đoạn 1 (SSR pipeline) đã code + test xong** - chi tiết thực thi ở
`status/app-router.md`. `page-handler.ts` giờ là caller thật đầu tiên gọi
`runWithDryContext`/`dry()` - `reader.md`'s Giai đoạn 4 ("nối vào App
Router") coi như xong theo đó (xem mục "`reader.md` sẽ ra sao" bên dưới).
Đã verify qua dev server thật (route tĩnh, route động `[slug]`, nested
layout, `dry()` query DB thật, 404 thật cho path không khớp) - xem
`status/app-router.md`'s bước 7 cho chi tiết. Chưa verify được:
`pages-cache`'s hành vi production thật (cache chỉ bật ngoài dev, chưa có
server production - Giai đoạn 3 - để test qua) - đã verify đầy đủ ở tầng
unit test thay thế (5 case).

Giai đoạn 2-4 chưa làm - `src/apps/pages` hiện lại trống (fixture test đã
xoá sau khi verify), sẵn sàng cho page thật đầu tiên.

2 quyết định user chốt trực tiếp khi lập kế hoạch (khác với cách ý tưởng
gốc đọc thoáng qua như "build ra file tĩnh"):

1. **SSR qua adapter** - render mỗi request trực tiếp (không phải build
   sẵn ra file `.html` tại build-time), dùng lại đúng adapter contract
   Node/Workers-portable đã có (`src/server/adapters/`), cùng tinh thần
   `handler.ts`'s `handleApiRequest` đang làm cho `/api/**`.
2. **HTML phải trả về cho client trước** - ưu tiên gửi sớm/streaming, không
   đợi buffer toàn bộ trang render xong mới gửi byte đầu tiên.

Cả 2 điều này **không mâu thuẫn** với câu "build thành file .html, .js, css
dùng chung" ở ý tưởng gốc - JS (hydrate bundle) và CSS (Tailwind output)
vẫn cần 1 bước Vite build thật (Giai đoạn 3), chỉ riêng **HTML shell** được
tạo bằng SSR-per-request thay vì pre-generate.

## `reader.md` sẽ ra sao

Tóm tắt quan hệ với `plans/reader.md` để khỏi phải lật lại:

- **Giai đoạn 4 của `reader.md`** ("nối vào App Router", đang note "chưa
  làm được gì - không có gì để nối vào") **coi như được giải quyết bởi
  Giai đoạn 1 dưới đây** - `page-handler.ts` chính là "caller thật đầu
  tiên" gọi `runWithDryContext`/`dry()` mà `reader.md` đang chờ. Dựng
  `entries` cho context: gọi thẳng `getContentAdapters(context)`
  (`src/server/content-adapters.ts:27`) - đúng helper mọi route admin
  đang dùng để tự tạo adapter D1 mới mỗi request (không cache ở module
  scope) - kế thừa luôn quy tắc "D1 phải dựng per-request" của
  `ARCHITECTURE.md` cho free, không phải nghĩ lại.
- **"Vite virtual module / global injection"** mà `reader.md`'s Giai đoạn 3
  để dành "khi có gì để inject vào" - làm luôn ở đây (`dry-global-
  plugin.ts`, quyết định kiến trúc #4 bên dưới).
- **1 thay đổi thật (nhỏ) vào code đã test của `reader.md`**: `touchedTypes`
  cho `pages-cache` (mục "Cách biết 1 trang phụ thuộc type nào" bên dưới) -
  thêm 1 field vào `DryRequestContext` + vài dòng ghi vào trong
  `dry-reader.ts`'s reader functions. Additive, không đổi behavior cũ,
  nhưng nên note lại vào chính `reader.md` sau khi code xong (xem "Thứ tự
  làm" ở cuối).
- **Không đổi, vẫn giữ nguyên như `reader.md` đã chốt**:
  - `get()` published-only tuyệt đối, `list()`'s `includeDraft` mặc định
    `false` - `pages-cache` chỉ cache OUTPUT của 1 render published-only
    bình thường, không đụng gì quy tắc này.
  - Cache dedup TRONG 1 lần render (key `(typeName, op, args)` cho 2
    component đọc trùng 1 entry) - `reader.md`'s Giai đoạn 3 tự hoãn vì
    "chưa có gì gọi lặp lại", **vẫn hoãn tiếp, KHÔNG bị thay thế bởi
    `pages-cache`**: 2 tầng cache khác nhau - `pages-cache` cache cả TRANG
    (cross-request, theo content-version); ý hoãn của `reader.md` là dedup
    nhiều lần gọi `dry()` trùng nhau NGAY TRONG 1 lần render (vd layout +
    page cùng đọc 1 entry). Vẫn đáng làm riêng sau này nếu profiling thấy
    cần, độc lập với `pages-cache`.
  - Preview/draft qua session - vẫn ở Giai đoạn 4 (Polish) dưới đây, và
    vẫn **không được cache** (đã ghi ở mục `pages-cache`'s "Gap chấp nhận
    cho v1").

## Quyết định kiến trúc

1. **Streaming SSR - đã spike, `renderToReadableStream` KHÔNG dùng được
   cho async function component, chọn phương án dự phòng 2-chunk**
   (2026-08-05, `src/server/app-router/render-stream.spike.test.ts`):
   - Đọc source `preact-render-to-string/dist/stream/index.mjs` xác nhận:
     renderer streaming gọi function component đồng bộ, nếu nó trả về
     Promise (đúng những gì 1 `async function` trả về) thì Promise đó bị
     coi là "object lạ" (có `.constructor`) và render ra chuỗi RỖNG, không
     đợi. Nó chỉ hỗ trợ Suspense-style (component THROW 1 promise ra, như
     `preact-iso/lazy`'s `LazyComponent`) - khác hẳn convention
     `async function Page() { await dry()...; return ... }` mà ý tưởng
     gốc/`reader.md` đã chọn.
   - `renderToStringAsync` thì xử lý đúng, đã verify bằng script thật: tự
     resolve cây bottom-up (`await Page(props)` trước, rồi
     `await Layout({ children: pageVnode })` từng lớp ra ngoài), sau đó
     `renderToStringAsync(layoutVnode)` ra đúng HTML lồng nhau.
   - **Quyết định**: `render.ts` tự resolve cây async bottom-up như trên
     (không dùng `renderToReadableStream`), lấy HTML BODY qua
     `renderToStringAsync` (buffered - không tránh được, vì chính cách
     await-rồi-return của convention này vốn không có "điểm dừng giữa
     chừng" để enqueue sớm). Bù lại vẫn giữ được stream THẬT ở **đúng 1
     ranh giới rẻ tiền**: enqueue phần `<!DOCTYPE html><head>...` (tĩnh,
     không phụ thuộc `dry()` - gồm cả `<link>` CSS chung) NGAY khi bắt đầu
     xử lý request, TRƯỚC khi await xong cây page/layout; enqueue phần
     `<body>`...`</body>` sau khi `renderToStringAsync` xong. Response vẫn
     là `ReadableStream` thật (khớp `adapters/node.ts`'s
     `sendFetchResponse` không đổi gì), trình duyệt bắt đầu tải CSS ngay
     từ chunk đầu thay vì đợi cả trang render xong - "HTML trả về cho
     client trước" đúng nghĩa cho phần không phụ thuộc dữ liệu, dù không
     progressive tới từng layout.
   - **Để sau nếu cần hơn**: streaming progressive theo từng layout (tách
     HTML mỗi layout quanh vị trí `children` bằng 1 sentinel string, render
     riêng phần "trước"/"sau" phần con) - phức tạp hơn hẳn, chỉ đáng làm
     nếu profiling cho thấy 2-chunk không đủ.
2. **Giữ nguyên "API async"** đã chốt trong `reader.md` - `page.tsx`/
   `layout.tsx` export `async function`, gọi `dry()` bên trong.
3. **Sửa lỗi `Dry.params` của ý tưởng gốc**: `reader.md` đã tự phê bình ý
   tưởng `Dry.params` gốc là 1 object global bị mutate mỗi request - đúng
   bug `AsyncLocalStorage` được chọn để né cho `dry()`. Áp dụng cùng bài
   học cho params: **truyền `params` như 1 prop bình thường** vào
   component (`export default async function Page({ params })`), không
   phải qua global `Dry.params` - đơn giản hơn AsyncLocalStorage (Preact
   props vốn đã thread đúng theo từng cây render), và đúng luôn convention
   Next.js mà ý tưởng gốc lấy làm tham chiếu.
4. **`dry()` global thật** (điều `reader.md` Giai đoạn 3 để dành "khi có gì
   để inject vào") - giờ có `src/apps/pages` rồi, làm luôn: 1 Vite plugin
   nhỏ, transform theo `id` khớp `src/apps/pages/**`, tương tự tiền lệ
   `dryComponentFilenamePlugin()` trong
   `src/components/RichTextField/build-component-bundle.ts` - chỉ khác là
   thay vì đổi tên hàm, nó chèn `import { dry } from ".../dry-reader.js"`
   nếu file có gọi `dry(` mà chưa tự import.

## Vị trí code mới

```
src/server/app-router/
  route-tree.ts   - quét src/apps/pages/**/{page,layout}.tsx bằng
                    import.meta.glob (tiền lệ: RichtextComponents.tsx,
                    virtual-fs-files.ts đã dùng glob kiểu này) -> cây route.
  match.ts        - pathname -> { pageLoader, layoutChain, params } | null.
                    Thứ tự ưu tiên kiểu Next.js: segment tĩnh > [dynamic]
                    > [...catchAll]. params.slug: string, params.path:
                    string[] cho catch-all.
  render.ts        - bọc runWithDryContext(...), resolve cây layout/page
                    bottom-up (await Page trước, await từng Layout bọc
                    ra ngoài - xem quyết định kiến trúc #1), render HTML
                    body qua renderToStringAsync, trả Response dạng
                    ReadableStream 2-chunk (head tĩnh trước, body sau khi
                    resolve xong).
  dry-global-plugin.ts - Vite plugin mục 4 ở trên.
src/server/page-handler.ts (hoặc thêm export vào handler.ts hiện có)
  - handlePageRequest(request, env): Promise<Response | null>.
    null = không khớp route nào -> caller tự quyết 404. CHỈ xét pathname
    NẰM NGOÀI path admin (window.__DRY_CONFIG__'s path/`config.ts`'s
    `path`) - đối xứng với AuthGate.tsx's `url.startsWith(path)` hiện có
    (AuthGate render rỗng khi NGOÀI path; handlePageRequest giờ lấp đúng
    khoảng trống "ngoài path" đó bằng nội dung site thật thay vì SPA rỗng).
src/apps/
  pages/           - cây file người dùng viết (page.tsx/layout.tsx/
                    [slug]/[...path]), như ý tưởng gốc mô tả.
  dry.generated.d.ts - đã có, không đổi cấu trúc, chỉ cần Vite plugin ở
                    trên biến `dry()` global trong đây thành gọi được thật.
```

Type context mới `DryPageContext` (mirror `server/context.ts`'s
`DryRouteContext`): `{ request, url, params, env, session }` - có sẵn
`session` dù chưa dùng ngay, để tính năng preview draft (mà `reader.md`
đã hoãn 1 lần) có chỗ cắm sau này mà không phải đổi chữ ký hàm.

## Cache SSR theo file (`pages-cache`)

Cache lại output SSR, chỉ cập nhật khi entry của collection/singleton mà
trang đó đọc có thay đổi; lưu thành file theo đúng cơ chế `storage` hiện
có, thư mục `pages-cache`. Cách ráp vào đúng những gì đã có:

- **Tín hiệu "đã đổi" - không cần tự chế**: `build-cache.md` đã có sẵn
  `ContentEntryEngineAdapter.getResourceVersion(type): Promise<number>`
  (`entries-types.ts:128`), bump mỗi lần create/update/delete/saveSingleton,
  cài cho cả sqlite+D1 rồi (thấy ở `entries-sqlite.ts:246,544`). Không cần
  cơ chế invalidate mới - dùng lại đúng con số version này làm "chữ ký độ
  tươi" của cache.
- **Lưu file - đúng thứ đã có**: `StorageAdapter` (`src/storage/types.ts`,
  `createStorageAdapter()`) là interface `list/read/write/remove/...` dùng
  chung cho `storage`/`icons`/`components`/`pageComponents` - thêm 1 root
  thứ 5 cùng cơ chế: `DryPagesCacheOption` trong `options.ts`, y hệt shape
  `DryPageComponentsOption` (`{ storage?: DryStorageOption }`), default
  root `.dry/pages-cache` (đã nằm trong `.gitignore`'s blanket
  `/.dry/` rule sẵn, khỏi sửa gì).
- **Cách biết 1 trang phụ thuộc type nào**: mở rộng nhỏ
  `DryRequestContext` (`dry-context.ts`) thêm `touchedTypes: Set<string>`;
  `dry-reader.ts`'s `mustFindType`/reader functions ghi tên type vào đây
  mỗi lần được gọi trong 1 lần render - vài dòng thêm vào code đã test của
  `reader.md`, không phải viết lại.
- **Luồng 1 request** (trong `render.ts`/`page-handler.ts`):
  1. Đọc `pages-cache/<encode(pathname)>.json` (envelope
     `{ html, versions: Record<typeName, number>, buildId: string,
     renderedAt: string }` - `buildId` xem mục ngay dưới đây).
  2. Có file -> so `buildId` trong file với `buildId` của lần chạy hiện tại
     trước (rẻ, so string thuần, khỏi đụng DB) - lệch -> miss ngay, khỏi
     cần check tiếp `versions`. Khớp `buildId` -> so tiếp `versions` với
     `getResourceVersion()` hiện tại của từng type ghi trong đó. Khớp hết
     -> trả thẳng `html` đã cache (vẫn stream ra được bình thường, chỉ là
     đọc từ file thay vì render). Lệch dù chỉ 1 type -> miss.
  3. Miss -> render như Giai đoạn 1 (streaming), đồng thời gom buffer toàn
     bộ chunk đã enqueue; sau khi `allReady` xong, snapshot
     `getResourceVersion()` cho từng type trong `touchedTypes` + `buildId`
     hiện tại, ghi ĐÈ lên cùng 1 path cache cũ - **không block response đã
     stream ra client**, ghi cache là side-effect chạy sau/song song, không
     phải điều kiện response coi là xong.
- **`buildId` - lưu như metadata trong chính file cache, không tách path**:
  Giai đoạn 3 sinh 1 `buildId` (UUID hoặc content-hash của lần build đó)
  đúng 1 lần, ghi vào 1 module hằng số được bundle theo `entry-node.ts`/
  `page-handler.ts` (như cách `dry.generated.d.ts` là "sinh 1 lần rồi
  bundle" - cùng tinh thần). So với namespace theo path
  (`pages-cache/<buildId>/...`):
  - (+) **Tự dọn dẹp** - deploy mới ghi ĐÈ đúng file cache cũ cùng path
    (route nào được ghé lại sau deploy sẽ tự cập nhật `buildId` mới ngay
    lần miss đầu); path-namespacing thì mỗi deploy đẻ ra 1 thư mục mới,
    thư mục build cũ không ai xoá, phải thêm bước GC riêng.
  - (+) So sánh rẻ hơn cả `versions` (so string, không cần biết trước cây
    thư mục nào đang "live") - kiểm tra được ngay bước đầu trước khi động
    tới `getResourceVersion()`.
  - (-) Route nào không có traffic sau deploy vẫn giữ 1 file cache cũ vô
    dụng (nhưng không NHÂN BẢN qua mỗi deploy như path-namespacing - chỉ 1
    file lỗi thời mỗi route, chấp nhận được, có thể thêm dọn theo
    `renderedAt` cũ sau nếu cần, không chặn v1).
- **Chỉ bật ở production, tắt ở dev**: cache theo version chỉ biết content
  đổi, KHÔNG biết code `page.tsx` tự thay đổi - nếu bật ở dev, sửa JSX
  xong F5 vẫn thấy bản cũ (content không đổi -> coi như hit) - ngược hẳn kỳ
  vọng "live preview qua vite" của ý tưởng gốc. Gate bằng
  `import.meta.env.DEV` (tiền lệ: `routes/richtext-components.ts`'s
  `buildAndStore` đã gate build-only-in-dev kiểu này, ở đây ngược lại -
  cache chỉ chạy khi KHÔNG phải dev).
- **Gap chấp nhận cho v1** (ghi rõ để không ai bất ngờ):
  - Cache key = pathname thôi, chưa tính query string - trang nào thực sự
    phân trang/lọc qua `?query` cần tự quyết định sau (loại trừ khỏi cache
    hoặc đưa query vào key).
  - Trang đọc `session`/request-specific data (chưa có trang nào ở v1,
    Giai đoạn 4's preview mode sẽ là trang đầu tiên) **không được cache** -
    phải nhớ loại trừ khi preview mode thật sự code, kẻo lộ nội dung
    riêng-tư qua cache dùng chung.
  - 2 request miss trùng thời điểm cho cùng 1 route: cả 2 tự render, ai
    ghi file sau cùng thắng - chấp nhận được cho v1, không dedup in-flight
    render.
  - Redeploy production: HTML cache cũ còn giữ `<link>`/`<script>` trỏ tới
    file CSS/JS theo content-hash CŨ - nếu build mới đổi hash mà không giữ
    lại file cũ, trang cache cũ trỏ tới asset ĐÃ MẤT -> vỡ giao diện. Rủi
    ro này giống nhau dù CSS gộp 1 file hay tách theo route (mục CSS bên
    dưới), chỉ khác bán kính ảnh hưởng. **Đã giải quyết** bằng `buildId`
    trong envelope cache ở trên - deploy mới luôn coi mọi cache cũ là miss
    ngay từ request đầu tiên sau deploy, áp dụng đều cho HTML lẫn asset
    reference.

## Cache cho `dry.generated.d.ts` - chuẩn bị cho code editor trên web sau này

Thay vì chỉ ghi thẳng `src/apps/dry.generated.d.ts` như hiện tại
(`reader.md`'s 2 hook: dev-server startup + `bun run dry:generate`), ghi
vào 1 cache trước - để sau này 1 code editor chạy thẳng trên trình duyệt
(viết `page.tsx` không cần mở local, kiểu mở rộng `Editer`/Component
Builder's `extraFiles` mechanism - xem `plans/component-builder.md` - sang
App Router) có chỗ đọc nội dung type này qua API, không cần quyền truy cập
filesystem. Cục bộ (local dev) vẫn cần 1 file thật trên đĩa cho `tsc`/IDE -
lấy đúng nội dung từ cache đó ra làm file.

Chi phí thấp - chỉ đổi ĐÍCH ghi (thêm 1 bước ghi cache trước khi ghi ra
file thật), không đổi trigger (vẫn 2 hook cũ y nguyên) hay thuật toán
generate (`generateDryTypes()` không đổi). Đúng diện "chuẩn bị hạ tầng cho
tính năng sau" giống tinh thần Component Builder trước đây ("Hạ tầng phục
vụ cơ chế page builder sau này... page builder chưa xây, plan riêng khi
tới lúc") - nên **chỉ làm phần lưu-vào-cache ở đây, KHÔNG xây API serve
cho editor hay chính cái editor đó** - tránh lấn phạm vi kế hoạch này.

- **Root cache riêng, không dùng chung `pages-cache`**: `pages-cache` cache
  HTML output theo route, invalidate theo content-VERSION (entry đổi); đây
  là cache cho 1 FILE TYPE DUY NHẤT, gắn với schema (content-TYPE đổi,
  không phải entry đổi) - khác tín hiệu, khác vòng đời. Gộp chung sẽ phá
  đúng nguyên tắc "4 root độc lập, không share thư mục" `ARCHITECTURE.md`
  đã nêu cho storage/icons/content/components - giữ nguyên tắc đó, thêm 1
  root nhỏ riêng (vd `DryTypesCacheOption`, default `.dry/types-cache`)
  cùng cơ chế `StorageAdapter` như mọi root khác.
- **Vẫn giữ `src/apps/dry.generated.d.ts` là file thật, commit vào git**
  như `reader.md` đã quyết định (fresh checkout cần type đúng ngay cả khi
  chưa chạy gì) - cache là bản sao THÊM, không thay thế. Luồng: generate ra
  1 string -> ghi vào `types-cache` (bản chính) -> ghi cùng string đó ra
  `src/apps/dry.generated.d.ts` (bản mirror cho local tooling).
- 2 hook hiện có (`dev-server.mjs` startup, `scripts/dry-generate.ts`) chỉ
  đổi ĐÍCH ghi thành "ghi cả 2 chỗ", không đổi trigger/thuật toán - làm
  cùng lúc với bước "Nối dev" ở Giai đoạn 1 (đang đụng `dev-server.mjs`
  sẵn rồi).

## Giai đoạn 1 - SSR pipeline (trọng tâm, làm trước) - XONG

1. ~~Spike `renderToReadableStream` + async component~~ - xong
   (2026-08-05), kết quả và quyết định ở mục "Quyết định kiến trúc" #1.
2. `route-tree.ts` + `match.ts` + unit test cho độ ưu tiên match (tĩnh >
   dynamic > catch-all, nested layout đúng thứ tự cha->con).
3. `render.ts` + `dry-global-plugin.ts`.
4. `page-handler.ts`, dùng lại `runWithDryContext`/`dry-reader.ts` nguyên
   trạng (không sửa `reader.md`'s code đã test).
5. `pages-cache` (xem mục riêng ở trên) - `DryPagesCacheOption` +
   `touchedTypes` trong `dry-context.ts` + đọc/ghi cache trong
   `page-handler.ts`, sau khi pipeline uncached ở bước 1-4 đã chạy đúng
   (thêm cache lên trên 1 render đã đúng, không làm đồng thời).
6. Nối dev: `scripts/dev-server.mjs` - nhánh mới, load
   `page-handler.ts` qua `vite.ssrLoadModule` (đúng pattern các module
   `src/server/**` khác đang được load ở đây), chèn TRƯỚC fallback
   "luôn serve admin index.html" hiện tại. Path ngoài `path` admin: thử
   `handlePageRequest` trước; khớp -> trả response (stream); không khớp ->
   404 thật (**đổi hành vi hiện tại** - hôm nay mọi path lạ đều rơi vào
   admin `index.html` rồi bị `AuthGate` render rỗng; sau phase này, path
   ngoài admin không khớp route nào phải là 404 thật, không phải trang
   trắng). Cùng lúc: wiring "ghi cả 2 chỗ" cho `dry.generated.d.ts` cache
   (mục ở trên).
7. Test thủ công: tạo `src/apps/pages/page.tsx` + 1 route động
   `src/apps/pages/blog/[slug]/page.tsx` gọi `dry()` thật, xem qua trình
   duyệt + `curl --no-buffer` để xác nhận HTML chảy sớm (không đợi cả
   trang). Sửa 1 entry của collection đó qua admin UI, F5 lại trang -
   xác nhận cache tự invalidate đúng (nội dung mới hiện ra, không phải
   bản cache cũ).

## Giai đoạn 2 - Client hydration + Tailwind v4 - XONG (2026-08-05)

Tailwind v4 xong trước; client hydration (`preact-iso/hydrate`) xong sau,
xem mục riêng bên dưới.

- `@tailwindcss/vite` cài + đăng ký vào `vite.config.ts` như dự kiến.
  `render.ts`'s `HEAD_AND_BODY_OPEN` giờ có
  `<link rel="stylesheet" href="/src/apps/globals.css">` - trỏ thẳng path
  nguồn, Vite dev server tự compile+serve CSS thật cho request `<link>`
  (đã verify bằng header `Sec-Fetch-Dest: style` giả lập trình duyệt thật -
  ra đúng CSS Tailwind, không phải JS wrapper). Giai đoạn 3 cần đổi path
  này sang asset đã build (chưa làm, ghi rõ trong code).
  `src/apps/globals.css` chỉ có `@import "tailwindcss";` - đúng quyết định
  1 file chung đã chốt.
- **Phát hiện + sửa 1 vấn đề dependency thật khi cài**: `tsc` báo lỗi
  "Excessive stack depth comparing types 'Plugin<any>[]'..." khi gộp
  `@tailwindcss/vite` + `@preact/preset-vite` + `dryGlobalPlugin` vào cùng
  `plugins: [...]`. Gốc rễ: `node_modules/.bun/` có SẴN nhiều bản `vite`
  trùng version khác hash (7.3.6 x2, 8.1.5 x2) từ trước - 2 plugin resolve
  `vite`'s type qua 2 instance khác nhau dù cùng version, `tsc` coi là 2
  type khác nhau. Sửa đúng gốc: thêm `"vite": "^8.0.13"` vào
  `package.json`'s `overrides` (đúng tiền lệ `rollup` đã có sẵn), xoá cache
  `.bun/vite@*` cũ, `bun install` lại - dedupe về đúng 1 instance,
  `defineConfig` bình thường chạy lại sạch không cần workaround nào khác.
- Đã kiểm tra bằng cURL: CSS output thật có đúng các utility class
  các trang demo dùng (`.flex`, `.gap-4`, `text-blue-600`,
  `hover\:underline`, `.border-dashed`, `.rounded-md`, `.font-bold`) - xác
  nhận Tailwind quét đúng `src/apps/pages/**/*.tsx`.
- 5 trang demo (`layout.tsx`/`page.tsx`/`users/{layout,page}.tsx`/
  `users/[slug]/page.tsx`/`roles/page.tsx`) đã đổi từ inline `style=""`
  sang class Tailwind - giữ lại trong repo làm ví dụ sống, không xoá như
  fixture Giai đoạn 1.

### HMR (full-reload) - đã làm

Page/layout render hoàn toàn ở server, chưa có client bundle nào (hydrate
vẫn chưa làm - mục dưới) nên Vite's HMR client không có module graph nào
để "walk" tới - route chuẩn cho kiểu SSR-only này là full-reload thô khi
file liên quan đổi, không phải HMR từng phần:

- `hmr-plugin.ts` (`appRouterHmrPlugin`, hook `handleHotUpdate`) - file đổi
  khớp `src/apps/pages/**` hoặc `src/apps/globals.css` -> broadcast
  `{ type: "full-reload" }` qua `server.ws`.
- `render.ts`'s head giờ có `<script type="module" src="/@vite/client">`
  (dev only, qua `import.meta.env.DEV`) - không có script này thì trình
  duyệt không có kết nối WebSocket nào để nhận tín hiệu reload.
- **Verify thật bằng WebSocket** (không chỉ đọc code): script Node nối vào
  đúng cổng HMR thật của Vite (**không phải port 5173** - `scripts/
  dev-server.mjs` tạo `http.createServer()` riêng ở middleware mode nên
  Vite tự mở 1 cổng HMR riêng, ở đây là `24678`, xem qua `lsof`), sửa
  `page.tsx`, nhận đúng `{"type":"full-reload"}` trong ~300ms.
- **Gap chấp nhận cho v1**: reload không giới hạn phạm vi (không set
  `path`) - tab admin đang mở cùng lúc cũng bị reload theo khi sửa trang
  App Router. Chấp nhận được (không mất dữ liệu, chỉ phiền nhẹ), chưa thu
  hẹp vì không muốn đoán mò cách Vite client match `path` khi chưa có nhu
  cầu thật.

### Client hydration - XONG (2026-08-05)

**Quyết định kiến trúc mới #5 - async component = data-fetching, KHÔNG
hooks; component đồng bộ con = hooks, không `dry()`.** Phát hiện qua spike
thật (`node -e`, dùng đúng bản `preact`/`preact-render-to-string` cài
trong repo, không đoán mò) khi user thử thêm `useState` vào 1
`async function page.tsx`:
- `preact-render-to-string`'s `_renderToString` có 1 check bảo mật
  (`node_modules/preact-render-to-string/src/index.js:315`:
  `if (vnode.constructor !== undefined) return EMPTY_STR;`) khiến 1
  `Promise` (return value của async component gọi qua `h()`) luôn bị coi
  là "không render được", trả rỗng - xác nhận lại đúng lý do Giai đoạn 1
  đã tự resolve cây bottom-up thay vì đưa thẳng async component vào
  `renderToStringAsync` (Quyết định kiến trúc #1).
- Nhưng spike CŨNG xác nhận: 1 component ĐỒNG BỘ (không `async`) lồng BÊN
  TRONG cây đã resolve đó (vd `<AddUserButton/>` bên trong `<main>` mà
  `UsersListPage` async trả về) hoạt động `useState` HOÀN TOÀN BÌNH
  THƯỜNG - vì `renderToStringAsync`/`hydrate()` đều dispatch nó qua đúng
  cơ chế Preact thật (set hook context trước khi gọi). `render.ts`/
  `resolveMatchToVNode` không cần đổi kiến trúc gì.
- Quy ước: giống Next.js App Router Server/Client Component, không cần
  directive `"use client"` - `async function` = data-fetching qua `dry()`,
  không hooks; tách phần tương tác ra 1 function con đồng bộ, nhận data
  qua props.

**Full data-replay** (theo lựa chọn user, xem 2 phương án đã cân nhắc ở
mục quyết định trước đây - lựa chọn còn lại "island-only" không chọn):
`dry-reader.ts`'s `get`/`list` giờ ghi thêm vào `DryRequestContext.callLog`
(field mới, optional, cùng idiom `touchedTypes`) - mỗi lần gọi 1 entry
`{kind, name, method, result}`. `render.ts` nhúng log này (qua
`dry-replay-codec.ts`'s `encodeCallLog` - JSON + tag riêng cho `Date`
instance vì field type `date` deserialize ra `Date` thật + escape mọi `<`
thành `<` cho an toàn nhúng `<script>`, đã verify bằng data thật chứa
rich text có `<p>`) vào `<script type="application/json"
id="dry-replay-data">` trước `<script type="isodata">` (phải là node CUỐI
trong `<body>` - đúng tiền lệ `preact-iso/prerender.js`, `hydrate.js` dùng
`isodata.parentNode` làm mount root).

`src/apps/hydrate-client.ts` (bundle riêng, nạp qua `<script type="module">`
trong head, chạy ở CẢ dev lẫn prod - khác `/@vite/client` chỉ dev):
`discoverRoutes()`+`matchRoute()` (dùng lại nguyên `route-tree.ts`/
`match.ts` - đã "pure", `import.meta.glob` chạy được ở client y hệt server,
tiền lệ `RichtextComponents.tsx`) khớp `window.location.pathname`, decode
log đã nhúng, gọi `resolveMatchToVNode` (logic resolve cây - tách từ
`render.ts` cũ ra `resolve-match.ts`, dùng chung 2 bên) với `dry()` bản
CLIENT (`dry-reader-client.ts` - không `AsyncLocalStorage`, chỉ 1 biến
module-level, trả data theo VỊ TRÍ tuần tự trong log, không match theo
key - đúng vì client chạy lại y hệt code path server đã chạy). `app-router-
plugin.ts`'s transform giờ chọn import `dry-reader.js` hay
`dry-reader-client.js` theo `this.environment.config.consumer` (`"server"`/
`"client"` - idiom chính bản Vite này dùng nội bộ).

`vite.config.ts` thêm `src/apps/hydrate-client.ts` làm entry thứ 3 (cạnh
`index.html`/`globals.css`) trong nhánh client-build đã có từ Giai đoạn 3;
`assets.ts` tổng quát hoá thành `resolveBuiltAssetHref` dùng chung, trả cả
`GLOBALS_CSS_HREF` lẫn `HYDRATE_ENTRY_HREF`.

**Fixture thật để verify** (không phải file tạm): `src/apps/pages/users/
page.tsx` - `AddUserButton` (đồng bộ, `useState` toggle class) tách ra khỏi
`UsersListPage` (async, gọi `dry()`) - đúng chính request thật của user.
`src/apps/pages/layout.tsx` revert về content-only (1 sửa lẫn từ phiên
trước tự thêm `<html>/<head>/<body>` lồng bên trong document shell của
`render.ts`, gây `<html>` lặp đôi - đã xác nhận qua user đây không phải chủ
đích, cần revert trước khi code hydration vì mount root phụ thuộc trực
tiếp).

**Verify thật** (Playwright, cả dev lẫn `bun run build && bun run start`):
mở `/`, `/users`, `/roles`, `/users/1`, path lạ (404) - 0 console
error/warning (không có cảnh báo hydration-mismatch/replay-mismatch nào);
click nút "Add User" trên CẢ 2 server (dev + production build) - class đổi
đúng từ `bg-blue-600` sang thêm `bg-green-600 hover:bg-green-700` - xác
nhận `hydrate()` THẬT SỰ gắn event handler, không phải HTML tĩnh. `curl`
xác nhận `dry-replay-data` chứa đúng data thật (kể cả field rich text có
`<p>` đã escape đúng `<p>`), `pages-cache` vẫn hoạt động đúng sau khi
thêm script tag mới (không phá cache cũ).

- Tailwind v4: thêm devDependency `@tailwindcss/vite`, đăng ký vào
  `vite.config.ts` (plugin chỉ transform file CSS có
  `@import "tailwindcss"` - CSS hand-rolled hiện có của admin không đụng
  tới, khỏi cần tách config riêng).

### CSS: 1 file chung cho cả `src/apps`, không tách riêng theo từng page

Cân nhắc giữa "mỗi page/route tự có entry CSS riêng" và "1 file CSS chung
cho toàn bộ App Router":

Lưu ý trước: với Tailwind, "CSS per file" không có nghĩa mỗi component tự
viết rule CSS riêng như hệ admin (`DESIGN.md`'s per-component `.css`) -
component vẫn viết class utility thẳng trong JSX. Cái thực sự khác nhau
giữa 2 phương án là **số lượng Tailwind entry point** (mỗi entry = 1 lần
`@import "tailwindcss"` = 1 file `.css` output riêng):

**1 entry chung** (đã chọn) - `src/apps/globals.css`, import 1 lần ở root
`layout.tsx`, mọi trang dùng chung 1 file `.css` output:
- (+) Trình duyệt tải+parse+cache CSS đúng 1 lần cho cả site; giữa các lần
  chuyển trang (mô hình MPA đã chọn ở dưới - mỗi nav là 1 request mới) CSS
  đã cache khỏi tải lại, chỉ HTML đổi.
- (+) Tailwind compile theo *usage thực tế trên toàn source tree*, không
  theo cấu trúc file - dù gộp 1 entry hay tách N entry, tổng utility class
  thực sự được dùng ở đâu đó là như nhau; gộp lại không "lãng phí" thêm
  byte nào so với tách, chỉ đổi cách chia nhỏ output.
- (+) 1 chỗ định nghĩa `@theme` (design tokens) duy nhất, khỏi lo đồng bộ
  token giữa nhiều entry.
- (-) File CSS chung phình dần theo số trang; trang đầu ghé site phải tải
  cả CSS của những trang họ chưa xem tới (chấp nhận được ở quy mô 1 site
  thường; Tailwind v4 nén khá tốt).

**N entry riêng theo route** - mỗi `page.tsx`/`layout.tsx` tự
`@import "tailwindcss"` riêng:
- (+) Lần ghé đầu tiên nhẹ hơn (chỉ tải CSS đúng trang đó) - có lợi nếu
  các trang khác biệt phong cách rất lớn.
- (-) Style dùng chung (header/footer/layout khung) bị nhân bản ra mỗi
  entry - mất đúng lợi ích cache-1-lần ở trên, mỗi lần chuyển trang tải
  lại cả phần đã có từ trang trước.
- (-) Setup Vite phức tạp hơn hẳn (đa entry CSS × đa entry JS × nhiều
  route ở Giai đoạn 3 vốn đã phức tạp - nhân thêm 1 chiều nữa).
- (-) Dễ lệch `@theme`/token giữa các entry nếu không kỷ luật share 1 file
  import chung - lúc đó lại thành nửa-chung-nửa-riêng, phức tạp hơn cả 2
  phương án gốc.

**Quyết định**: 1 file CSS chung. Khớp với mô hình MPA + cache-qua-điều-
hướng đã chọn, đơn giản hơn cho Giai đoạn 3, và không phải quyết định
one-way-door - thêm entry phụ cho 1 nhóm trang đặc biệt sau này vẫn làm
được nếu thật sự cần, không phải đổi kiến trúc gốc.

Đã xét lại sau khi thêm `pages-cache`: có 1 rủi ro thật là HTML cache cũ
trỏ tới CSS/JS hash đã bị build mới xoá mất, nhưng rủi ro này tồn tại y hệt
dù CSS gộp hay tách - tách theo route chỉ thu hẹp bán kính vỡ, không loại
bỏ được rủi ro. Gốc rễ đã có cách sửa riêng (`buildId` trong envelope
cache) áp dụng như nhau bất kể chọn phương án CSS nào, nên không phải lý
do đủ mạnh để đổi hướng - giữ nguyên 1 file chung.

- Câu hỏi còn treo (xem mục "Giả định" bên dưới): điều hướng giữa các
  trang App Router là MPA hay SPA client-side - quyết định này chọn
  `hydrate()` gọi 1 lần mỗi trang (MPA) hay bọc thêm 1 `Router`/
  `LocationProvider` như admin (SPA).

## Giai đoạn 3 - Production build - XONG (2026-08-05)

Scope thật hoá ra đơn giản hơn hẳn hướng đi speculative đã ghi trước đây
(dưới đây), đúng vì Giai đoạn này CHỈ cần SSR chạy được trong production -
không cần client hydration bundle (Giai đoạn 2's phần đó vẫn chưa làm, để
sau, độc lập):

- **Không cần script Node/multi-entry riêng cho route discovery** - đã xác
  nhận bằng cách đọc thẳng source `vite` cài trong repo
  (`node_modules/vite/dist/node/chunks/node.js:32938`): `vite build --ssr
  <entry>` khiến `<entry>` là input DUY NHẤT cho build đó, hoàn toàn không
  quan tâm `rollupOptions.input` khác trong config. `page-handler.ts` ->
  `route-tree.ts`'s `import.meta.glob(...)` chỉ cần được import (transitively)
  từ `entry-node.ts` - Rollup tự code-split từng `page.tsx`/`layout.tsx`
  thành chunk riêng trong `dist/server`, không cần liệt kê entry files thủ
  công. (Ý tưởng "vendor chunk Preact dùng chung + multi-entry" bên dưới
  vẫn đúng CHO client hydration bundle sau này khi Giai đoạn 2 làm tiếp -
  không áp dụng cho SSR bundle.)
- `package.json`'s `build` script không đổi gì - vẫn 2 lệnh `vite build`
  cũ. `vite.config.ts` chuyển sang function-config form để dùng
  `isSsrBuild` context - chỉ build client (`vite build --outDir
  dist/client`, không có `--ssr`) mới thêm `src/apps/globals.css` làm
  entry thứ 2 + bật `build.manifest: true`; build SSR (`--ssr
  entry-node.ts`) không đụng gì (đã verify key: manifest key theo path
  nguồn relative-root `"src/apps/globals.css"`, không phải theo tên alias
  đặt trong `rollupOptions.input`).
- `src/server/app-router/assets.ts` (mới) - `resolveGlobalsCssHref(dev,
  manifestPath?)`: dev trả thẳng path nguồn (như cũ); prod đọc
  `dist/client/.vite/manifest.json` lấy path asset đã build+hash thật.
  `render.ts`'s `<link>` giờ dùng `GLOBALS_CSS_HREF` thay vì hardcode path
  nguồn.
- `buildId` (`build-id.ts`) không cần đổi gì - `randomUUID()` per-process-
  start đã tự thoả đúng contract "mỗi lần deploy = buildId mới" mà không
  cần build-time content-hash.
- `entry-node.ts` - thêm nhánh mới: static asset (dist/client) check TRƯỚC
  (khác dev - dev có Vite middleware tự lọc asset request trước khi tới
  App Router, prod không có lớp đó nên phải tự kiểm tra file thật trước,
  nếu không request kiểu `/assets/main-abc123.js` sẽ bị App Router route
  nhầm thành "không khớp route -> 404", vỡ JS bundle của chính admin) -> rồi
  mới tới nhánh `handlePageRequest` cho path ngoài admin (khớp -> stream,
  không khớp -> 404 thật) -> cuối cùng mới fallback admin SPA shell.

Verify qua `bun run build && bun run start` thật + `curl` - xem
`status/app-router.md`'s Giai đoạn 3 section cho chi tiết.

### Hướng đi cũ (không còn áp dụng cho SSR, giữ lại cho client hydration bundle sau này)

- 1 script Node mới (kiểu `scripts/dry-generate.ts`) quét `route-tree.ts`'s
  cùng cơ chế glob để liệt kê **entry files thật** (page/layout paths), feed
  vào 1 lần `vite build` với nhiều `rollupOptions.input` (hoặc nhiều lần gọi
  `build()` như `build-component-bundle.ts` đang làm cho từng component) -
  output JS theo từng route + 1 vendor chunk Preact dùng chung (tiền lệ:
  `buildSharedPreactBundle()`). Đây là việc cho **client hydration bundle**
  (browser cần discover/tải đúng file JS theo route), khác hẳn SSR bundle
  (Node tự resolve import tương đối, không cần biết trước tên file).

## Giai đoạn 4 - Polish / để sau

- Preview draft qua session cookie (đã hoãn 1 lần ở `reader.md`, hoãn tiếp
  - `DryPageContext.session` đã có chỗ cắm sẵn).
- Trang 404/error tuỳ biến (`not-found.tsx` kiểu Next.js).
- ~~`<head>`/metadata per-page (title, meta tags)~~ - **XONG (2026-08-05,
  xem `status/reader-seo.md`)**: SEO cascade Default (`features.seoDefault`
  singleton) < Singleton < Entry (`dry-seo.ts`'s `DrySeoLayers`/
  `mergeSeoLayers`, filled as a side effect of `dry()`'s `get()` calls),
  render vào `<title>`/`og:*`/`description` sau khi `resolveMatchToVNode`
  resolve (`render.ts` không còn enqueue head tĩnh ngay lập tức nữa - xem
  doc comment mới ở đó cho lý do vẫn không mất gì so với streaming cũ).

## Ý tưởng lớn hơn: page lưu qua storage, build on-demand (chưa scope, để sau)

Ý tưởng: thay vì `page.tsx`/`layout.tsx` nằm trong `src/apps/pages`
(source thật trong git), lưu chúng qua 1 `StorageAdapter` riêng (cùng cơ
chế `pages-cache`/`components`/`pageComponents`) - cho phép sửa/thêm trang
Ở PRODUCTION mà không cần commit+deploy code, có 1 hành động "build lại"
riêng (giống nút Build của RichText component/Component Builder), gắn liền
với việc làm mới `pages-cache` tương ứng.

Có tiền lệ mạnh (`build-component-bundle.ts` đã làm đúng "code lưu qua
storage, build on-demand qua nested `vite.build()`" cho RichText confirmed
component) - nhưng đây là **1 mô hình khác** với Giai đoạn 1-3 ở trên (file
thật trong `src/apps/pages`, Next.js-referenced như ý tưởng gốc mô tả),
không phải chỉnh sửa nhỏ:

- `route-tree.ts`'s `import.meta.glob` (Giai đoạn 1) chỉ thấy file trong
  source tree Vite biết tại build/dev-time - file lưu qua storage phải đổi
  route discovery sang runtime (`storage.listAll()`, đã có sẵn), không
  dùng glob được nữa.
- Dev "live preview qua vite" (yêu cầu gốc) khó giữ - file ngoài `src/`
  không được Vite tự HMR/transform, phải tự build lại mỗi lần sửa giống
  hệt production, mất cảm giác sửa-xong-F5-thấy-ngay.
- Mất git history/PR review theo trang (đổi lại lấy được: sửa live không
  cần deploy, tương tự tiền lệ Component Builder's `Editer`+build flow).

**Quyết định hiện tại**: KHÔNG kéo vào Giai đoạn 1-3 - giữ nguyên
file-trong-repo cho v1 (đã có spike rủi ro kỹ thuật riêng, không nên đổi
nền tảng giữa chừng). Ghi lại đây thành hướng đi rõ ràng cho sau, đúng cách
`component-builder.md` tự nhận mình là "hạ tầng cho page builder sau này,
plan riêng khi tới lúc" - ý này chính là hình hài cụ thể hơn của cái "page
builder sau" đó (storage + build-on-demand + gắn `pages-cache`). Cần bàn
lại kỹ trước khi scope chi tiết.

## Quyết định: điều hướng giữa trang - MPA (đã chốt, 2026-08-05)

**MPA thuần** (mỗi link là 1 lần load trang thật, `hydrate()` chỉ chạy cho
đúng trang đang đứng) - không phải SPA client-side. Lý do chốt: khớp chữ
"hydrate tải lazy về sau" trong ý tưởng gốc hơn, JS tải về ít nhất, và
SSR-per-request (quyết định đã chốt, Giai đoạn 1-3 đã code+test xong theo
đúng model này) vốn đã làm mỗi navigation = 1 request mới rồi - SPA sẽ cần
thiết kế MỚI HOÀN TOÀN 1 cơ chế fetch data cho transition (`page.tsx`/
`layout.tsx` là `async function` chạy Ở SERVER, client router không có gì
để gọi) và phá luôn giả định "SSR per request" mà `render.ts`/`page-handler.ts`
đã dựa vào - rủi ro/effort cao hơn hẳn so với lợi ích (chuyển trang mượt
hơn, giữ state UI xuyên trang) cho v1. Giai đoạn 2's phần hydration còn lại
code theo hướng này: `hydrate()` gọi 1 lần mỗi trang, không bọc thêm
`Router`/`LocationProvider` nào.

## Kiểm chứng

- Unit test `match.ts` (độ ưu tiên route, nested layout, catch-all).
- `bun run typecheck` xanh sau khi `dry.generated.d.ts`'s global `dry()`
  thật sự gọi được (không còn cần import tay).
- Test thủ công qua dev server thật (không phải chỉ đọc code): trang tĩnh,
  trang `[slug]` gọi `dry()`, `curl --no-buffer` xác nhận stream, nested
  layout render đúng thứ tự, path ngoài admin không khớp trả 404 thật.
- `bun run test` (vitest) không có test nào vỡ (route mới không đụng code
  cũ ngoài phần dev-server.mjs/entry-node.ts).
- Unit test riêng cho cache: hit khi version không đổi, miss khi 1 trong
  các type phụ thuộc bump version, miss khi `buildId` lệch, và xác nhận
  cache bị bỏ qua hoàn toàn khi `import.meta.env.DEV`.

## Thứ tự làm

1. ~~Giai đoạn 1 (SSR pipeline)~~ - xong (2026-08-05), chi tiết ở
   `status/app-router.md`.
2. ~~Giai đoạn 2 (hydrate + Tailwind)~~ - xong (2026-08-05, Tailwind trước,
   hydrate sau cùng phiên với Giai đoạn 3).
3. ~~Giai đoạn 3 (production build)~~ - xong (2026-08-05).
4. Giai đoạn 4 - sau, không chặn việc dùng App Router ở dev/prod.
5. ~~Sau khi Giai đoạn 1 chạy được, quay lại `reader.md` đánh dấu Giai đoạn
   4 của nó "xong"~~ - xong, xem mục "`reader.md` sẽ ra sao" ở đầu file.
