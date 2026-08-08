# App R2 - trang public build sẵn, server không SSR

Plan này **đã gộp `plans/page-builder.md`** vào (page builder là giai đoạn
cuối của chính cơ chế này, không phải tính năng riêng). File kia giữ lại
nguyên văn ý tưởng gốc, không còn là plan độc lập.

## Ý tưởng gốc (giữ nguyên văn)

- Các trang chính là nằm trong src/apps/pages

Nghiên cứu ý tưởng trên production
- các file .tsx sẽ lưu trong R2 thành file txt
- Khi clint gọi "/about" lấ file "/about/page.tsx", "/about/layout.tsx", "/layout.tsx" + dữ liệu trong reader (dry)

# người dung có thể đổi code trực tiếp trên brower và lưu lại
- có thể lưu file .js vì brower đã có sẵn có chế chuyển tsx thành file .js (`<div>` -> h("div"))
- 1 thư mục tên src/**/**.tsx song song với pages/**/**.js
- server dùng render html string

# cơ chế client (admin mode)

- khi người dùng chỉnh sửa 1 trang vd /about/page.tsx thì sẽ build lại các trang liên quan bằng brower, sau đó lưu vào R2
- khi có data D1 thay đổi cũng build lại trang phụ thuộc

kết quả là server sẽ có cache tương ứng chỉ có HTML, js server không cần ssr

### Từ `page-builder.md` (giữ nguyên văn)

- cơ chế ở MVP1 là dạng edit code ở tại trang admin
- có bên trái là cây thư mục tham chiếu cho /src/apps/**/**
- tát cả các file trong src/apps/ là lưu trong R2
- Khi thay đổi 1 file .tsx, 1 singletone hay 1 entry collection sẽ build lại trang kèm tailwincss riêng cho từng trang (không build dư)
- drycms bản chat là server file nhỏ các dịch vụ xây quay xây dụng ra file html js css, phục vụ một số chức năng thực sự cần thiết ví dụ như schudule (cơ chế riêng)
- môi trang build sẽ build luôn 1 đoạn xml riêng khi gọi sitemap.xml sẽ lấy all về và build thành xml chung cho goole

## Quyết định user đã chốt

1. **Admin là builder duy nhất.** Trang chưa build thì chưa tồn tại. Không
   có fallback SSR ở server, không cron render, không queue nền.
2. **Server không SSR gì cả** - chỉ đọc file đã build ra và trả về. Đây là
   thứ gỡ bỏ blocker `eval`/`new Function` trên workerd (xem "Vì sao không
   SSR ở server" bên dưới).
3. **Dev giữ nguyên như hiện tại** - Vite SSR + live preview, không build,
   không cache. Toàn bộ cơ chế này chỉ bật khi lên server thật. Local server
   nếu có build thì chỉ đóng vai trạm trung chuyển file (browser build →
   server ghi xuống đĩa/R2), không tự render gì.
4. **VEI inline edit cũng phải build được.** VEI đã nhúng sẵn app admin
   trong iframe ẩn (`vei:save`/`vei:saved` postMessage - `overlay.ts`'s
   `saveTarget`), nên nó chạy được đúng pipeline build đó. Save → build →
   reload.
5. **Phạm vi đẩy lên R2 là `src/apps/pages/**`, KHÔNG phải cả `src/apps/`.**
   `hydrate-client.ts`, `globals.css`, `vei/overlay.ts` là rollup input
   (`vite.config.ts` dòng 92-94) - phải ở lại đĩa và build bằng Vite như cũ.
   `dry.generated.d.ts` có đường riêng (mục 10).
6. **Git vẫn giữ `pages/**`; sync lên R2 bằng script, không ghi đè.** Script
   chỉ upload file **chưa có** trên R2; file đã có thì bỏ qua. Nghĩa là repo
   là seed cho lần khởi tạo, còn sau đó R2 thắng - và deploy lại không bao
   giờ xoá thứ user sửa trong browser (mục 13).
7. **Object bất biến + con trỏ, ngay từ v1** (không phải "ghi đè tại chỗ cho
   v1" như bản plan trước đề xuất). Lý do đổi: bảng `_pages` ở quyết định 8
   *đã chính là* chỗ chứa con trỏ, nên phương án này gần như miễn phí; và nó
   là điều kiện cần cho `schedule` (mục 9) lẫn rollback (mục 12).
8. **Metadata build nằm trong bảng D1/SQLite, không phải manifest KV.** Một
   bảng `_pages` + `_page_deps` thay cho: index ngược `content-type → pages`,
   `PageCacheEnvelope.versions`, và trạng thái stale của UI Build (mục 5).
9. **CSS build theo từng trang, không phải 1 file global.** (mục 6)
10. **Component Builder giữ nguyên, không đụng tới trong đợt này.**
    `.dry/components` + option `pageComponents` để nguyên; sẽ dọn sau.
11. **Cron flip mặc định 60 phút, chỉnh được trong Settings.** Bài viết
    không đổi liên tục và không phải bài nào cũng cần hẹn giờ - 60 phút là
    mặc định đúng. Dự án nào cần nhanh thì hạ xuống trong setting (mục 9).
12. **Tách 2 permission**: `system-code` (sửa `.tsx`) và `system-build`
    (bấm Build/Rebuild). Biên tập viên nội dung build lại trang được mà không
    đụng được vào code - đúng ranh giới rủi ro thật, vì sửa code = chạy code.

Hệ quả trực tiếp của (1): mọi thay đổi data phải đi qua browser có phiên
admin. Ghi bằng seed script/HTTP API trực tiếp sẽ KHÔNG tự lên trang - xem
"Rủi ro đã chấp nhận".

## Vì sao không SSR ở server

workerd cấm sinh code từ string: `eval`/`new Function` ném
`EvalError: Code generation from strings disallowed`, và từ compat date
`2026-03-17` + `nodejs_compat` còn thêm cờ `disallow_eval_during_startup`.
Nên phương án "server lấy `.js` từ R2 rồi chạy" là bất khả thi trực tiếp -
lưu `.js` thay vì `.tsx` không giải quyết được, vì vấn đề là *thực thi code
dạng string*, không phải compile.

Lối chính thức duy nhất là Dynamic Workers (Worker Loader binding, open beta
3/2026). Quyết định #1 ở trên chọn cách khác: **không render ở server thì
không cần lối nào cả**. Đây là lý do bản kế hoạch này đơn giản hơn hẳn.

## Kiến trúc

### Đường build (trong browser admin)

```
sửa .tsx  ─┐
data đổi  ─┼─► admin/VEI iframe ─► compile (sucrase) ─► render (preact-render-to-string)
           │                                    │
           │                                    ├─► HTML ─────► R2  pages/<buildHash>/<path>.html
           │                                    ├─► page.js ──► R2                (bất biến)
           │                                    └─► page.css ─► R2                     │
           │                                                                           ▼
           └───────────────────────────────────────────────► D1 _pages/_page_deps  + copy sang
                                                              (con trỏ + deps)      key "live"
```

### Đường serve (worker/node)

```
GET /about ─► R2 GET pages/live/about.html ─► trả HTML ─► browser tải page.js + page.css ─► hydrate
```

**Không D1 query, không JSON parse, không render.** Key R2 suy ra thẳng từ
pathname (đúng như `pages-cache.ts`'s `cacheKeyFor` đang làm) - con trỏ nằm ở
tầng build/cron, không nằm ở tầng serve (xem mục 12). Miss = 404 thật.

### Dev - không đổi gì

Dev chạy y như hôm nay: Vite SSR mỗi request, live preview, HMR, không
cache, không build. Điểm may mắn là **cái cổng cần thiết đã tồn tại sẵn**:
`page-handler.ts:102` đang gate `readPageCache` bằng `!import.meta.env.DEV`,
nên toàn bộ cơ chế mới nằm gọn sau đúng cờ đó - không phải thêm nhánh nào
cho dev.

Chỗ để chạy thử đường prod là **`bun run dev:worker`** (wrangler dev +
miniflare R2 local), không phải `bun run dev`. e2e của tính năng này cũng
phải trỏ vào đó, hoặc vào một build thật - chạy qua Vite SSR thì không test
được gì của kế hoạch này.

Đánh đổi đã chấp nhận: thứ QA ở dev (Vite compile, SSR mỗi request) không
phải thứ chạy ở prod (sucrase compile, browser render, HTML tĩnh). Riêng VEI
sẽ có hai hành vi khác nhau hẳn - dev thì SSR tươi mỗi lần, prod thì HTML
tĩnh + patch DOM phía client. Bug loại này chỉ lộ ở `dev:worker`/prod.

## Cái đã có sẵn - dùng lại, không viết mới

| Việc | Đã có ở |
|---|---|
| Compile TSX→JS trong browser + mini module system (⚠️ phải mở rộng, xem dưới) | [`src/page-components/sucrase-eval.ts`](../src/page-components/sucrase-eval.ts) |
| Bằng chứng `new Function` chạy được trong browser admin | [`sucrase-eval.ts:67`](../src/page-components/sucrase-eval.ts#L67) - đang chạy thật trong Component Builder |
| Rewrite import specifier | [`src/page-components/import-rewrite.ts`](../src/page-components/import-rewrite.ts) |
| Editor code + typecheck TS trong browser | [`src/components/Editer/`](../src/components/Editer/) |
| Cây file + CRUD qua storage adapter (mẫu để copy) | [`routes/page-components.ts`](../src/server/routes/page-components.ts), [`src/page-components/tree.ts`](../src/page-components/tree.ts) |
| Resolve route → vnode (dùng chung server/client) | [`resolve-match.ts`](../src/server/app-router/resolve-match.ts) |
| Match path → route + params | [`match.ts`](../src/server/app-router/match.ts), [`route-tree.ts`](../src/server/app-router/route-tree.ts) |
| Lưu/đọc HTML theo pathname trên R2 | [`pages-cache.ts`](../src/server/app-router/pages-cache.ts) |
| Serve từ cache | [`page-handler.ts:102`](../src/server/page-handler.ts#L102) |
| Theo dõi phụ thuộc `page → content-type` | `touchedTypes` trong `page-handler.ts` |
| So version để biết stale | `entries.getResourceVersions(types)`, bảng `_versions` |
| Bảng hệ thống prefix `_` (mẫu để copy) | [`entries-d1.ts:245`](../src/content-types/engine/entries-d1.ts#L245) `ensureVersionsTable` |
| Ghi file qua HTTP + adapter local/R2 | [`routes/storage.ts`](../src/server/routes/storage.ts), [`storage-adapters.ts`](../src/server/storage-adapters.ts) |
| Root `types-cache` + ghi `dry.generated.d.ts` vào storage | [`types-cache.ts`](../src/content-types/types-cache.ts), [`options.ts:31`](../src/server/options.ts#L31) |
| Edge cache (Cache API) | [`edge-cache.ts`](../src/server/app-router/edge-cache.ts), gọi ở [`entry-worker.ts:103`](../src/server/entry-worker.ts#L103) |

Nói cách khác: **nửa "serve" của kế hoạch này gần như đã xong**. Việc chính
là đảo chiều người đổ đầy cache - từ pull (server SSR khi miss) sang push
(browser đẩy lên khi save).

## Phải xây

### 1. Route manifest thay `import.meta.glob` ⚠️ chưa plan nào nhắc tới

[`route-tree.ts:117`](../src/server/app-router/route-tree.ts#L117) khám phá
route bằng `import.meta.glob("/src/apps/pages/**/{page,layout}.tsx")` -
**compile-time**. File `.tsx` nằm trên R2 thì glob chỉ thấy những gì có trên
đĩa lúc build client. Tạo `/pricing/page.tsx` trong browser sẽ **không sinh
ra route nào**: `staticPagePaths()` không thấy, builder không biết layout nào
bọc nó.

`buildRouteTree` vốn đã pure (nhận vào một modules map) nên không phải đụng.
Việc cần làm là `discoverRoutes()` có 2 nguồn:

- dev: `import.meta.glob` như cũ;
- prod/builder: dựng modules map từ **file list trên R2** (một manifest sinh
  ra mỗi lần lưu file, hoặc `listAll()` của storage adapter).

Đây là **điều kiện tiên quyết** cho gần hết các mục dưới, phải nằm ở giai
đoạn 2 chứ không phải giai đoạn 5.

### 2. `buildDocument()` - tách phần dựng `<head>`/`<body>` ra khỏi stream

`render.ts` hiện trộn "dựng document" với "stream response". Tách ra một hàm
thuần `buildDocument(vnode, ctx) → string` để cả server (nếu còn cần) lẫn
browser builder gọi chung. `ctx` phải chứa **origin tường minh** - build
chạy ở tab admin (`localhost:5173`) trong khi site là `https://…`, mà
`canonical`/`og:url`/`resolveImageSrc` đều phụ thuộc origin. Không được lấy
`window.location`.

### 3. `dry()` bản thứ ba: đọc qua HTTP

Hiện có `dry-reader.ts` (server/D1) và `dry-reader-client.ts` (replay). Build
trong browser cần bản đọc qua HTTP API.

**Bắt buộc: ép published-only ở phía server, không tin session.** Browser
đang đăng nhập admin, nếu để API trả cả draft/scheduled thì bản nháp bị nướng
thẳng vào HTML public trên R2. `isPublished()` (`dry-populate.ts:56`) là
điều kiện phải áp ở endpoint build, không phải ở client.

Bản này vẫn phải sinh `callLog` y như bản server để nhúng replay data cho
hydration (`dry-replay-codec.ts`).

### 4. Liệt kê param cho route động

`/blogs/[slug]/page.tsx` muốn build sẵn thì phải biết hết slug. Query danh
sách slug từ collection tương ứng lúc build (kiểu `generateStaticParams`).
Route catch-all `[...rest]` **v1 không hỗ trợ** - khai báo path tay để sau.

### 5. Bảng `_pages` + `_page_deps`

Thay hoàn toàn manifest KV của bản plan trước. Theo đúng tiền lệ `_versions`
([`entries-d1.ts:245`](../src/content-types/engine/entries-d1.ts#L245)):
bảng hệ thống prefix `_`, `CREATE TABLE IF NOT EXISTS`, bootstrap lười +
memo theo binding. **Không** làm nó thành content type - đây là metadata
build, không được hiện trong danh sách content của admin.

```sql
CREATE TABLE IF NOT EXISTS "_pages" (
  "path"       TEXT PRIMARY KEY,   -- "/blogs/abc"
  "object_key" TEXT NOT NULL,      -- build bất biến đang live: "pages/<hash>/blogs/abc.html"
  "build_id"   TEXT NOT NULL,
  "built_at"   INTEGER NOT NULL,   -- dùng luôn làm <lastmod>
  "in_sitemap" INTEGER NOT NULL,   -- 0 khi noIndex / 404 / 500
  "publish_at" INTEGER             -- NULL = live ngay; tương lai = chờ cron (mục 9)
);

CREATE TABLE IF NOT EXISTS "_page_deps" (
  "path"     TEXT NOT NULL,
  "resource" TEXT NOT NULL,        -- tên content type, khớp _versions.resource
  "version"  INTEGER NOT NULL,
  PRIMARY KEY ("path", "resource")
);
```

Ba câu query, mỗi cái 1 lần:

- sitemap: `SELECT path, built_at FROM _pages WHERE in_sitemap = 1 AND (publish_at IS NULL OR publish_at <= ?)`
- build lại gì khi sửa entry `blog`: `SELECT path FROM _page_deps WHERE resource = 'blog'`
- danh sách stale cho admin: JOIN `_page_deps` với `_versions` chỗ version
  lệch - **1 query, thay cho việc list R2 rồi parse N envelope**

Vì sao bảng chứ không phải KV blob: 2 admin build cùng lúc thì rewrite blob
là last-writer-wins (mất row), còn bảng thì mỗi trang 1 row upsert độc lập;
xoá trang là `DELETE` 1 row; và sitemap > 50k URL phân trang bằng
`LIMIT/OFFSET` thay vì tự shard tay (KV value cap 25MB).

**Phải dọn row khi xoá.** Xoá entry / xoá `page.tsx` mà quên `DELETE` là
sitemap trỏ thẳng vào 404. Nối vào cả đường xoá entry lẫn đường xoá file,
không chỉ đường build.

### 6. Tailwind build trong browser, CSS riêng từng trang

`globals.css` hiện build lúc build-time bằng cách scan source. User thêm
class mới trong browser thì không có CSS tương ứng. Dùng `@tailwindcss/browser`
(v4) ngay trong bước build.

**Vì sao per-page chứ không phải 1 file global:**
[`assets.ts:22`](../src/server/app-router/assets.ts#L22) bake
`GLOBALS_CSS_HREF` (content-hash) vào HTML mỗi trang. Giữ 1 CSS chung có hash
thì thêm 1 class ở bất kỳ trang nào cũng đổi hash → **phải build lại HTML tất
cả các trang**. Đúng cái "build dư" cần tránh, và làm "chỉ build 1 trang" bất
khả thi.

Tập file cần scan **rơi ra miễn phí** từ bước build: `sucrase-eval.ts` đã
resolve import graph nên biết chính xác trang đó chạm những `.tsx` nào.

Đánh đổi: utility lặp lại giữa các trang, không cache chung. Với site content
(khách vào từ Google, xem 1 trang) thì lãi.

### 7. Hydration từ `.js` động

`hydrate-client.ts` đang dò route bằng `import.meta.glob` trong bundle. Đổi
sang: đọc manifest route (mục 1) + `import("/…/page.js")` động. Phía browser
chạy ESM động **không cần eval**, nên phần này dễ. Nhưng import trong page
(`preact/hooks`, `../../dry.generated.js`) phải resolve được → import map
trong `<head>`, hoặc rewrite specifier lúc compile (`import-rewrite.ts` đã
làm việc tương tự).

Tối ưu đáng làm: trang không có island tương tác thì bỏ hẳn hydration - gắn
cờ per-page lúc build.

### 8. `sitemap.xml` đọc từ bảng, không query D1 kiểu cũ

[`sitemap.ts:57`](../src/server/app-router/sitemap.ts#L57) hiện query D1
trực tiếp và loop `publishedEntries` 500 row/lần - **mâu thuẫn thẳng với
quyết định #2**. Đổi sang 1 câu `SELECT` từ `_pages` (mục 5).

Được thêm miễn phí: [`sitemap.ts:51-55`](../src/server/app-router/sitemap.ts#L51-L55)
ghi rõ `noIndex` của một trang TĨNH không được phản ánh "vì kiểm tra thì phải
render thật" - với mô hình mới trang **được render thật lúc build**, nên chỉ
việc ghi kết quả `mergeSeoLayers` vào `in_sitemap`. Hạn chế đó biến mất.

**Giữ live query đúng 1 thứ:** `siteNoIndex`
([`sitemap.ts:63`](../src/server/app-router/sitemap.ts#L63)) là setting
runtime đọc từ `seoDefaults`. Bật lên thì toàn bộ `in_sitemap` trong bảng
sai. Đọc live 1 lần (1 singleton, rẻ) rồi trả sitemap rỗng - đừng rebuild
10k row.

### 9. `schedule` - build sẵn 2 bản, cron đảo con trỏ

Feature `schedule` (`system-fields.ts:150`, opt-in per content-type) publish
bài bằng *thời gian trôi qua*, không có sự kiện ghi nào để bắt. Cron cũng
không cứu được bằng cách render, vì cron vẫn là workerd (vẫn cấm `eval`).

Cách giữ nguyên "server không render":

- Lúc build, nếu entry có `publishAt` tương lai thì **build luôn cả 2 bản**:
  bản hiện tại và bản sau khi bài lên. Cả hai lưu bất biến ở
  `pages/<buildHash>/…`, bản tương lai kèm `publish_at` trong `_pages`.
- Cron (Cloudflare Cron Trigger) chạy định kỳ: `SELECT` các row có
  `publish_at <= now` chưa flip → copy object đó đè lên key "live" → cập nhật
  `object_key`, xoá `publish_at`. **Không render gì cả.**
- Lưu ý: R2 binding không có copy phía server - "copy" là `get()` + `put()`
  chảy qua worker. Với HTML cỡ vài chục KB thì không sao, nhưng chi phí cron
  tỉ lệ với số trang flip cùng một phút.

**Tần suất (quyết định #11): mặc định 60 phút, chỉnh trong Settings.** Có một
ràng buộc phải nói rõ: **lịch Cron Trigger nằm trong `wrangler.jsonc`, tức là
deploy-time** - một setting runtime không thể làm cron chạy *nhanh hơn* nhịp
đã khai báo. Nên:

- `wrangler.jsonc` khai báo nhịp mịn nhất từng cần (đề xuất `*/15 * * * *`);
- handler đọc setting `scheduleFlipIntervalMinutes` (mặc định 60) từ singleton
  `systemSettings` (đã có sẵn - `routes/system-settings.ts`) và **bỏ qua** nếu
  chưa đủ khoảng cách kể từ lần chạy trước;
- muốn nhanh hơn 15 phút thì phải sửa `wrangler.jsonc` + deploy lại. Ghi rõ
  điều này ngay cạnh ô setting, đừng để user tưởng chỉnh xuống 1 phút là chạy.

Lần chạy rỗng gần như miễn phí: cùng đúng câu `SELECT MIN(publish_at)` mà mục
14 vốn đã cần cho việc cap TTL sitemap - không có gì tới hạn thì thoát ngay.

Đây là thứ `page-builder.md` gọi là "schedule (cơ chế riêng)", và là lý do
quyết định #7 chọn con trỏ thay vì ghi đè tại chỗ.

### 10. `dry.generated.d.ts` qua `types-cache`

Đã xây sẵn ~70%: [`types-cache.ts:20`](../src/content-types/types-cache.ts#L20)
`writeGeneratedDryTypes()` **đã ghi cả 2 nơi** (đĩa + storage adapter), root
`types-cache` đã tồn tại ([`options.ts:31`](../src/server/options.ts#L31)),
và adapter đó đã chạy R2 được (`options.test.ts:64`). Comment trong file nói
thẳng: *"prep for a future browser-based code editor to read this over an API
instead of the filesystem, not built yet."*

Còn thiếu đúng 3 việc:

1. **Trigger.** Hiện chỉ có 2 trigger, cả hai đều là Node: dev-server startup
   (`dev-server.mjs:69`) và `bun run dry:generate`. **Không cái nào chạy khi
   save metadata** → trên prod file types đóng băng ở trạng thái lúc deploy.
   Móc vào đường apply schema ở
   [`routes/content-types.ts`](../src/server/routes/content-types.ts) (sau khi
   migration chạy xong) - phải server-side.
2. **`writeGeneratedDryTypes` sẽ nổ trên Workers.**
   [`types-cache.ts:1`](../src/content-types/types-cache.ts#L1) import
   `node:fs/promises` và gọi `mkdir`/`writeFile`. Hôm nay an toàn vì chỉ script
   Node gọi; khi trigger vào request path thì nó chạy trên worker. Tách: ghi
   storage **luôn luôn**, ghi đĩa **chỉ khi có filesystem**. Giữ nhánh ghi đĩa
   lại - `tsc`/IDE local vẫn cần.
3. **Route đọc.** Chưa có endpoint nào serve `types-cache`. Editer cần nó làm
   `extraFiles` cho TS Language Service. Theo mẫu `routes/page-components.ts`.

Rủi ro thấp nhất trong cả plan: `.d.ts` bị xoá lúc compile và Sucrase strip
type **không type-check**, nên file này **không nằm trên đường build**. Stale
thì hỏng autocomplete, không hỏng site. Ghi đè thẳng, không cần version/rollback.

Lưu ý khi nối vào Editer: khối `declare global` cuối file khai báo
`dry()`/`params()`/`setTitle()`/`dryBind()`. File có `import type` ở đầu nên
nó là *module* - `declare global` vẫn chạy, nhưng file phải được **đưa vào TS
program**, không chỉ resolve được.

### 11. UI Build trong admin

- Danh sách trang + trạng thái: đã build / stale / chưa build. Stale = JOIN
  `_page_deps` với `_versions` (mục 5), 1 query.
- Nút "Build lại trang này" / "Build tất cả".
- Progress + resume được (sửa `layout.tsx` gốc = build lại mọi trang; đóng
  tab giữa chừng là chuyện sẽ xảy ra).
- Batch PUT lên storage, đừng 500 request rời rạc.
- Hiện cả ở dev (ghi xuống đĩa local; xem kết quả qua `dev:worker`).

### 12. Sửa `page-handler.ts` + bỏ `PageCacheEnvelope`

Hiện [`pages-cache.ts:38-63`](../src/server/app-router/pages-cache.ts#L38-L63)
làm 3 việc trên **mỗi request**: R2 GET envelope (HTML nhét trong JSON) →
`JSON.parse` → thêm 1 round trip D1 `getResourceVersions()` → so version. Mà
prod **vẫn trả HTML cũ khi stale** (dưới đây) - nên toàn bộ phép so version đó
ở prod là công vô ích.

- Metadata sang bảng (mục 5) → R2 chứa **HTML thô**. Serve = 1 lần R2 GET,
  không parse JSON, không chạm D1. Nhanh hơn hiện tại.
- Key R2 suy ra từ pathname (như `cacheKeyFor` đang làm), **không** đọc
  `object_key` mỗi request - con trỏ chỉ dùng cho admin/rollback/cron.
  Build ghi bất biến `pages/<buildHash>/<path>.html` rồi copy sang key live.
- Prod (`!import.meta.env.DEV`): chỉ đọc cache, bỏ nhánh render. Miss = 404.
  Dev đi tiếp nhánh SSR hiện tại, không đụng vào.
- **Ở prod, VEI không còn bypass cache được** (không còn SSR để bypass sang).
  VEI chạy trên HTML tĩnh + overlay patch DOM phía client -
  `applyPendingDrafts()` đã làm đúng việc đó rồi. Sau `saveAll()` thì chạy
  build cho trang hiện tại + trang phụ thuộc, xong mới
  `window.location.reload()`. Ở dev, VEI vẫn bypass + SSR như cũ.
- Stale (version lệch) thì **vẫn trả HTML cũ**, không 404. Trang cũ tốt hơn
  trang mất. Staleness báo trong admin, không báo cho khách.
- Rollback = copy một object bất biến cũ đè lên key live + cập nhật
  `object_key`. Cũng là cách chữa trường hợp build dở giữa chừng làm site nửa
  mới nửa cũ.

### 13. Script sync git → R2 (quyết định #6)

- Upload `src/apps/pages/**` từ repo lên R2, **bỏ qua file đã tồn tại**.
  Không có cờ `--force` trong v1: một lần lỡ tay là mất hết code user sửa
  trong browser.
- Chạy tay, không nối vào `bun run build`/deploy.
- **Chiều ngược (pull R2 → đĩa) làm cùng đợt, không để sau.** Không có nó thì
  code user sửa trong browser không bao giờ về git - mất lịch sử, mất blame,
  mất code review. Cùng nguyên tắc: không ghi đè file đã có.

### 14. Edge cache: TTL riêng cho sitemap

Sitemap đã đi qua edge cache sẵn (`entry-worker.ts:103` bọc mọi response,
`storeEdgeCache` cho phép content-type `xml`). Vấn đề là TTL:

- [`edge-cache.ts:101`](../src/server/app-router/edge-cache.ts#L101) **ghi đè
  vô điều kiện** `Cache-Control` bằng `s-maxage=${pagesCacheEdgeTtl}` (mặc
  định 60s) → header 24h mà sitemap tự set sẽ bị xoá. `storeEdgeCache` phải
  nhận TTL theo từng response.
- [`edge-cache.ts:65`](../src/server/app-router/edge-cache.ts#L65)
  `isEdgeCacheable` trả `false` khi `pagesCacheEdgeTtl <= 0` - tắt cache
  trang sẽ tắt luôn cache sitemap. Tách 2 cờ ra.
- **Cap TTL theo lần publish kế tiếp.** TTL 24h phẳng có lỗ: bài hẹn 09:00 mà
  cache nạp lúc 08:59 thì mất tăm khỏi sitemap gần 24h. Lúc build response
  (chỉ chạy khi miss, tức ~1 lần/ngày) query thêm
  `SELECT MIN(publish_at) FROM _pages WHERE publish_at > ?` rồi đặt
  `s-maxage = min(86400, next - now)`. Không có gì hẹn giờ thì tự khắc là 24h.

## Rủi ro đã chấp nhận (hệ quả của quyết định #1)

- **Ghi không qua browser thì không lên trang.** `bun run seed:pages`, HTTP
  API, tích hợp ngoài, admin khác... đều làm site stale âm thầm. Giảm nhẹ
  bằng mục 11 (hiện trạng thái stale trong admin) - biến "sai âm thầm" thành
  "sai nhìn thấy được".
- **Code prod không nằm trong git** (trừ khi user chủ động pull về, mục 13).
  Không lịch sử, không blame, không rollback bằng git - chỉ có rollback bằng
  object bất biến (mục 12).
- **Mất typecheck/test trên code prod.** Code sửa trong browser không qua
  `tsc`/`vitest`/e2e. `Editer/ts-worker.ts` đỡ được phần typecheck, phần còn
  lại thì không.
- **Ai sửa được page = chạy được code** (trong browser admin, không phải trên
  server - nhẹ hơn nhiều so với bản SSR). Gate bằng `system-code`, tách khỏi
  `system-build` (quyết định #12), cả hai theo mẫu `system-vei`.
- **`.tsx` là source of truth, `.js` chỉ là cache.** Không tin `.js` client
  gửi lên như thứ độc lập - phải luôn compile lại được từ `.tsx`.
- **Sitemap trễ tối đa 24h** khi không có gì hẹn giờ (mục 14). Google crawl
  sitemap theo lịch riêng của nó nên mức này nằm trong nhiễu bình thường.

~~`schedule` không tự lên bài~~ → đã giải bằng mục 9.

## Giai đoạn

**Spike trước (nửa buổi, chưa cam kết gì):** dựng 1 trang tĩnh đơn giản
(`/about`) đi hết đường: compile `.tsx` bằng sucrase trong browser →
`resolveMatchToVNode` → `renderToStringAsync` → PUT HTML lên storage → worker
serve. Chứng minh được hoặc chết ở đây.

`sucrase` và `preact-render-to-string` đều đã nằm trong `dependencies` (tức
đã ship được xuống browser), và `new Function` đã chạy thật trong Component
Builder - nên tiền đề "browser eval được, server không" **không còn là giả
thiết**. 4 thứ còn lại thì chưa ai xác minh lúc viết plan; **đã chạy spike
2026-08-09** (harness throwaway, xoá sau khi ghi nhận - chi tiết
`status/app-r2-spike.md`), kết quả:

1. **✅ Allowlist bare specifier - CONFIRMED chạy được.** Mở rộng
   `resolveModulePath` (vốn throw với mọi bare specifier - đúng chủ ý
   Component Builder "chỉ import file") bằng một allowlist (`preact`,
   `preact/hooks` trỏ vào chính instance đang chạy) là đủ. Chạy full pipeline
   THẬT (không stub): eval qua allowlist → `resolveMatchToVNode` (nguyên hàm
   thật) → `renderToStringAsync` (nguyên hàm thật) trên chính
   `src/apps/pages/page.tsx` + `layout.tsx` hiện tại → ra HTML đúng byte-for-
   byte với cấu trúc layout lồng page. ~6ms eval+resolve, <1ms render (trang
   đơn giản, không có island). Đây vẫn là **mở rộng**, không phải tái dùng
   nguyên trạng - `sucrase-eval.ts` gốc không đổi.
2. **✅ ESM output - CONFIRMED chạy được, nhưng có một cái bẫy mới phát
   hiện.** Bỏ transform `imports` (giữ `jsx`+`typescript`) ra đúng ESM hợp lệ
   - nhưng **sucrase's classic JSX pragma (`jsxPragma:"h"`) không tự inject
   `import { h, Fragment } from "preact"`**, khác với "automatic" JSX
   runtime. Nhánh CJS che được lỗ này bằng cách truyền `h`/`Fragment` làm
   tham số cho `new Function(...)` (đúng mẹo `sucrase-eval.ts` đang dùng);
   nhánh ESM thật (`<script type=module>` load `page.js`) không có mẹo đó -
   **bước build phải tự chèn dòng import này**, cùng cách
   `app-router-plugin.ts` đã chèn import cho `dry`/`params` hôm nay. Ghi
   thêm vào mục 7 làm việc phải làm, không phải chuyện tự nhiên có.
3. **⚠️ `@tailwindcss/browser` - xác minh được nguồn, CHƯA chạy sống được.**
   Đã cài (`bun add -d @tailwindcss/browser`) và đọc thẳng source
   (`packages/@tailwindcss-browser/src/index.ts` trên repo
   `tailwindlabs/tailwindcss`): package này **tự chạy khi import, chỉ dựa
   vào DOM** - gọi `rebuild('full')` một lần lúc import, sau đó một
   `MutationObserver` theo dõi `document` (thẻ `<style type="text/tailwindcss">`
   đổi, `class` attribute đổi, node mới) và quét bằng
   `document.querySelectorAll('[class]')`. **Không có API lập trình/headless
   nào cả.** Hệ quả kiến trúc cho mục 6 (chưa có trong bản plan trước): build
   1 trang phải thực sự **mount HTML đã render vào một document sống** (kể cả
   ẩn/offscreen), không thể đưa "chuỗi .tsx" vào thẳng; và vì observer/
   stylesheet là toàn cục theo tab, build nhiều trang liên tiếp trong cùng 1
   phiên admin phải cô lập từng trang (iframe riêng mỗi lần build, hoặc diff
   stylesheet trước/sau) để CSS trang A không lẫn vào trang B.
   Việc chạy thử sống (mount thật + đọc CSS sinh ra) **bị chặn** - trình
   duyệt Playwright của máy đang bị một phiên khác giữ (đúng kịch bản
   [[feedback_concurrent_repo_editing]]) - chưa ép mở. Cần chạy lại khi
   trình duyệt rảnh trước khi khoá mục 6.
4. **Đã đo được 1 phần, chưa đủ.** Eval+resolve+render+ESM-check cho 1 trang
   đơn giản (Node, vitest, cùng pipeline Vite thật) ≈ 11ms tổng - nhanh, đáng
   yên tâm, nhưng KHÔNG gồm: thời gian compile Tailwind thật (mục 3 chưa chạy
   được), bundle admin phình bao nhiêu (harness chưa nối vào entry point
   thật), và một trang có nhiều file/component hơn.

Còn lại của spike (mục 3 chạy sống, và đo mục 4 đầy đủ) làm nốt khi trình
duyệt rảnh - không chặn việc bắt đầu Giai đoạn 1, vì cả 2 đều nằm ở mục 6
(CSS), không phải mục 1-2 (route manifest, build core).

1. **Build core** - `buildDocument()` tách ra, `dry()` HTTP published-only,
   build 1 trang tĩnh, ghi qua storage adapter. Serve từ cache, miss = 404.
   Bỏ `PageCacheEnvelope`, R2 chứa HTML thô.
2. **Route manifest + bảng + route động** - mục 1 (bỏ `import.meta.glob`),
   mục 5 (`_pages`/`_page_deps`), mục 4 (liệt kê param), build theo phụ thuộc.
3. **CSS + hydration** - Tailwind browser build per-page, `page.js` động +
   import map, cờ bỏ hydration cho trang tĩnh.
4. **Sitemap + schedule** - mục 8, 9, 14. Cron flip con trỏ.
5. **UI Build + VEI** - trang Build trong admin (trạng thái/stale/progress/
   resume), VEI save → build → reload.
6. **Sửa code trong browser** (nội dung `page-builder.md`) - cây thư mục
   `src/apps/pages/**` + Editer, lưu R2, build lại trang liên quan, script
   sync (mục 13), `types-cache` cho `dry.generated.d.ts` (mục 10). Đây là mục
   tiêu cuối, nhưng là phần *dễ nhất* một khi 1-5 xong - nó chỉ là thêm một
   nguồn trigger build.

Mục 10 (`types-cache`) có thể tách ra làm sớm bất cứ lúc nào - nó độc lập với
mọi thứ còn lại.

## Câu hỏi còn mở

Không còn câu nào chặn việc bắt đầu. Câu duy nhất còn lại là **contingent, chỉ
trả lời sau spike**: nếu `@tailwindcss/browser` không chạy được với input trong
bộ nhớ (ẩn số #3 của spike) thì fallback là gì - CSS global href cố định +
ETag (không hash, không phải rebuild HTML), hay CSS global có hash và chấp
nhận rebuild toàn site mỗi lần đổi class?

~~Cron flip mỗi bao lâu?~~ → **Đã chốt: mặc định 60 phút, chỉnh trong
Settings** (quyết định #11).

~~Chiều pull R2 → git có làm ngay không?~~ → **Đã chốt: làm cùng giai đoạn 6.**

~~Permission tách hay gộp?~~ → **Đã chốt: tách `system-code` +
`system-build`** (quyết định #12).

~~Full rebuild ghi đè tại chỗ hay bất biến + con trỏ?~~ → **Đã chốt: bất biến
+ con trỏ, ngay từ v1** (quyết định #7).

~~Route `[...rest]`?~~ → **Đã chốt: v1 không hỗ trợ.**

~~Trang Build có hiện ở dev không?~~ → **Đã chốt: có, ghi xuống đĩa local.**

~~Có giữ live preview Vite ở dev không?~~ → **Đã chốt: dev giữ nguyên hoàn
toàn, cơ chế này chỉ bật ở server thật.**
