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
  `window.location.reload()`. Ở dev, VEI vẫn bypass + SSR như cũ. **✅ Làm
  xong + live-verify 2026-08-09** (mục "Giai đoạn" bên dưới, mục 7 phần
  cuối) - `overlay.ts`'s `rebuildAffectedPages()`.
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
3. **✅ `@tailwindcss/browser` - CONFIRMED chạy sống (2026-08-09, trình duyệt
   rảnh trong phiên build sau).** Nguồn thật
   (`packages/@tailwindcss-browser/src/index.ts`): tự chạy khi import,
   `MutationObserver` theo dõi `document`, không có API lập trình/headless.
   Chạy thử sống trong Playwright thật (không phải suy luận từ source nữa):
   - **Mount đúng thứ tự → ra CSS thật, đúng class.** Bẫy: `<style
     type="text/tailwindcss">` phải được thêm vào DOM **TRƯỚC** khi import
     package - lần chạy đầu thêm SAU nên `ruleCount: 0` (styleObserver có vẻ
     chỉ bind vào các thẻ đã tồn tại lúc import, không tự phát hiện thẻ thêm
     sau). Sau khi sửa thứ tự: 19 rule thật, `.bg-red-500`/`.p-4` có mặt,
     header đúng `tailwindcss v4.3.3`.
   - **Rò rỉ CSS giữa các lần build được XÁC NHẬN LÀ CÓ THẬT, không chỉ lo
     xa.** Build trang B ngay sau trang A trong CÙNG document: B có đúng
     class của B (`.bg-blue-700`), nhưng CSS đã compile **vẫn còn nguyên
     `.bg-red-500` của trang A** (`stillHasBgRed500FromPageA: true`). Same
     `<style>` tag được cập nhật tại chỗ, không tách riêng theo trang.
   - **Cô lập bằng iframe riêng mỗi lần build - CONFIRMED hoạt động.** Một
     iframe mới (realm/document/module-registry riêng), tự import package
     trong CHÍNH document của nó (không phải import từ parent - ESM import
     không nhận "document nào" làm tham số, phải chèn `<script
     type="module">` thẳng vào iframe's document), compile ĐÚNG và CHỈ ĐÚNG
     nội dung của iframe đó (`.bg-green-500`, không dính gì từ A/B).
   
   **Quyết định kiến trúc cho mục 6, giờ đã có bằng chứng thật:** mỗi lần
   build 1 trang phải chạy trong 1 iframe ẩn mới, huỷ sau khi lấy xong CSS -
   không tái dùng document/observer giữa các trang.
4. **Đã đo được 1 phần, chưa đủ.** Eval+resolve+render+ESM-check cho 1 trang
   đơn giản (Node, vitest, cùng pipeline Vite thật) ≈ 11ms tổng - nhanh, đáng
   yên tâm, nhưng KHÔNG gồm: thời gian compile Tailwind thật (đo được ở lần
   chạy sống 2026-08-09: mount + compile 1 trang mất khoảng vài trăm ms,
   xem `status/app-r2-build.md`), bundle admin phình bao nhiêu (chưa đo -
   cần nối vào entry point thật), và một trang có nhiều file/component hơn.

~~Còn lại của spike (mục 3 chạy sống)~~ → **Đã chạy xong 2026-08-09** khi
trình duyệt rảnh - xem mục 3 dưới đây, kết quả CONFIRMED (không còn giả
thiết).

1. **✅ Build core (2026-08-09, `status/app-r2-build.md`).**
   `buildDocument()` tách ra (`build-document.ts`, `render.ts` không đổi hành
   vi), `dry()` HTTP published-only (`dry-reader-http.ts` + `routes/dry-http.ts`),
   compile+render 1 trang qua `page-build.ts` (spike's allowlist mở rộng,
   `dry`/`params`/`setTitle`/`dryBind` qua tham số `new Function` - đã kiểm
   chứng bằng test thật, không phải suy luận), ghi qua storage adapter
   (`built-pages-storage.ts` + `routes/pages-build.ts`). Bỏ
   `PageCacheEnvelope` **cho nhánh mới** (namespace `built/` riêng, không
   đụng cache cũ). **Chưa nối vào đường serve thật** - xem quyết định #8 mới
   bên dưới.
2. **✅ Route manifest + bảng + route động, ĐỦ cả mục 4 (2026-08-09).**
   mục 1 (`route-manifest.ts`, tái dùng `buildRouteTree`/`matchRoute` không
   đổi), mục 5 (`_pages`/`_page_deps`, dual engine), mục 4
   (`dynamic-routes.ts` - khớp template `[param]` với `seoUrlPattern` của
   content type, kiểu `generateStaticParams`; không thêm field config mới,
   dùng lại đúng field đã có). Đã chạy thật dưới `wrangler dev`: tạo content
   type `blogPost` (feature slug + `seoUrlPattern:"/blogs/{slug}"`) + 1
   entry qua API thật, `/blogs/[slug]` tự hiện thành `/blogs/hello-world`
   trong UI Build, bấm Build ra đúng nội dung (`params().slug` đúng, layout
   chain đúng) - xem `status/app-r2-build.md`. Route catch-all (`[...rest]`)
   vẫn đúng như quyết định gốc: bỏ qua, không build.
3. **✅ CSS + hydration - CẢ HAI xong, chạy sống dưới `wrangler dev`
   (2026-08-09).** Ẩn số chặn (mục 6) đã giải quyết - xem mục 6 ở "Kết quả
   spike" phía trên. `tailwind-build.ts` (build/render qua iframe cô lập)
   đã xây + test. mục 7 (hydration): `page-build.ts`'s `compileEsmAsset`
   compile TOÀN BỘ closure (entry + layout + mọi import cục bộ chúng kéo
   theo) ra ESM thật, viết lại import tương đối thành URL public
   (`built-assets`), chèn manifest (`#dry-hydrate-manifest`/
   `#dry-hydrate-params`) vào HTML; `hydrate-built.ts` (bootstrap riêng,
   không qua `import.meta.glob`) đọc manifest, `import()` entry/layout +
   `hydrate` động lúc chạy.
   **Bẫy thật tìm thấy khi build+chạy sống (không phải suy luận):**
   `preact-runtime.ts` KHÔNG thể là `rollupOptions.input` bình thường -
   build ra thật (`bun run build:worker`) cho thấy Rollup coi barrel
   thuần `export {...} from "preact"` là pass-through vô dụng và loại bỏ
   gần hết export (`preserveEntrySignatures:"strict"` VÀ `treeshake:false`
   đều thử, cả hai KHÔNG có tác dụng) - lý do: consumer THẬT của các tên
   này (`h`/`Fragment`/hooks) là JS đã compile của 1 trang, sinh ra SAU,
   ngoài build này hoàn toàn, nên Rollup không bao giờ thấy chúng "được
   dùng". Nếu để `hydrate-built.ts` import tĩnh `hydrate` từ file này
   (đã thử) thì NÓ bị Vite bundle chung với instance Preact riêng của
   admin app - khác instance với `page.js` load lúc chạy, hook sẽ hỏng.
   **Sửa đúng:** build `preact-runtime.ts` qua Vite **library mode**
   (nested `vite.build({build:{lib:...}})`, mirror
   `RichTextField/build-component-bundle.ts`'s `buildSharedPreactBundle` -
   lib mode giữ NGUYÊN mọi export bất kể build có "thấy dùng" hay không),
   lưu 1 lần vào `built-assets` storage (`ensurePreactRuntimeAsset`, key
   cố định `__dry/preact-runtime.js`), phục vụ qua route đã có sẵn;
   `hydrate-built.ts` `import()` ĐỘNG `hydrate` từ CHÍNH URL đó (không
   import tĩnh) để browser's module cache đảm bảo cùng 1 instance với
   `page.js`. Gate build-once dùng `process.versions.node` (Node có thể
   chạy Vite tooling, cả dev lẫn prod) chứ KHÔNG phải `import.meta.env.DEV`
   (thử trước, sai: `wrangler dev` luôn chạy bundle PRODUCTION nên
   `DEV` luôn false ở đó, sẽ never bootstrap được kể cả lúc test local).
   **Xác nhận sống:** build 1 trang test có `useState` counter dưới
   `wrangler dev` thật (D1+R2 thật), fetch HTML build xong qua
   `/dry/api/pages-build?path=`, load trong Playwright thật, bấm nút 3
   lần → "Count: 0" → "1" → "2" đúng, `window.dryHydrated===true`, 0 lỗi
   console. Trang test + source đã dọn sạch sau khi xác nhận.
4. **✅ Sitemap + schedule - CẢ HAI xong và đã cutover thật (2026-08-09).**
   mục 8 (`buildSitemapResponseFromRegistry`) giờ ĐÃ thay
   `page-handler.ts`'s `/sitemap.xml` handler thật ở prod - đi CÙNG LÚC với
   mục 12's cutover bên dưới (bắt buộc phải đi cùng nhau, xem lý do ở đó).
   mục 9 (2026-08-09): thêm nốt setting
   `scheduleFlipIntervalMinutes` (quyết định #11) - `lib/
   schedule-flip-setting.ts` (pure, share được cả server lẫn client, tránh
   lặp lại bẫy "module server kéo theo client build" đã gặp ở mục 7) đọc
   field này từ CHÍNH `systemSettings.data` blob Settings.tsx (Color
   schema) đã dùng cho theme - UI chỉnh nằm ở `PageBuild.tsx` (mục "Publish
   schedule", gate quyền theo `systemSettings` type chứ không phải
   `system-build`, vì đây là singleton của type khác). `entry-worker.ts`'s
   `scheduled` đọc setting này TRƯỚC khi gọi `runScheduledFlip`, bỏ qua
   sớm (0 D1 nào ngoài đọc chính `systemSettings`) nếu chưa đủ khoảng cách
   kể từ lần chạy trước - "lần chạy trước" lưu 1 timestamp trong KV
   (`getAuthSecurityStore`, reuse store đã có cho auth/rate-limit, namespace
   riêng `"schedule-flip"` - đúng tiền lệ `rate-limit.ts` đã reuse cùng
   store cho 1 việc "không hẳn auth" khác).
   **Bug thật tìm thấy khi thiết kế phần này (không phải khi build):**
   `Settings.tsx`'s save cũ GHI ĐÈ TOÀN BỘ `data` bằng đúng 15 key theme nó
   biết, nên save 1 màu bất kỳ sẽ ÂM THẦM XOÁ `scheduleFlipIntervalMinutes`
   (hoặc bất kỳ key nào page khác từng ghi vào cùng blob). Sửa: cả
   `Settings.tsx` lẫn `PageBuild.tsx`'s save giờ đều merge lên dữ liệu ĐÃ
   load được (`{...otherStoredData, ...ownKnownFields}`) thay vì ghi đè
   thẳng `value`. **Xác nhận sống dưới `wrangler dev` thật:** chỉnh
   interval = 45 ở Page Build, Save; sang Color schema đổi màu Primary,
   Save; fetch lại `systemSettings` qua API - CẢ HAI đều còn nguyên trong
   cùng 1 blob (`scheduleFlipIntervalMinutes:45` + `primaryColor:"#123456"`).
   Gọi `/cdn-cgi/local/scheduled` (endpoint wrangler dev cung cấp để trigger
   cron tay) 2 lần liên tiếp - cả 2 đều log "skipped (45min interval not
   yet elapsed)" đúng như kỳ vọng (KV state của lần chạy trước đó vẫn còn
   từ trước khi set interval, sống sót qua cả việc restart `wrangler dev` -
   đúng tính chất persist local KV/D1 miniflare). Nhánh "đủ giờ thì chạy"
   được test đơn vị đầy đủ (4 test case, cả 2 nhánh, timestamp giả lập kiểm
   soát được) thay vì chờ thật 45 phút. mục 14 xong (`isEdgeCacheable`/
   `storeEdgeCache` thêm `ttlSeconds` optional, không đổi hành vi cũ).
5. **✅ UI Build - ĐỦ, khớp mục 11 (2026-08-09).** `PageBuild.tsx` (nav
   "System" → "Page Build", quyền `system-build`): liệt kê CẢ trang tĩnh lẫn
   trang động đã resolve qua `route-manifest.ts` + `dynamic-routes.ts` (mục
   4, xong - ~~route động chưa liệt kê được~~ là nhận định CŨ, viết trước
   khi mục 4 xong trong CÙNG phiên này, đã lỗi thời: `/blogs/hello-world`
   liệt kê+build đúng, xác nhận sống lại lần nữa hôm nay khi test mục 8),
   cột trạng thái (not-built/stale/scheduled/live) từ `_pages`, nút
   Build/Build all chạy thật `page-build.ts` rồi publish. VEI cũng đã có thể
   trigger build headless qua trang này (`?autoBuild=`, mục 8).
   - **Batch PUT**: `POST /api/pages-build` giờ nhận thêm `{ pages: [...] }`
     (nhiều trang/1 request) bên cạnh body 1-trang cũ (không đổi, vẫn dùng
     cho `buildOne`/`?autoBuild=` - gộp 1 trang vào batch chỉ thêm overhead).
     `buildAll()` build tuần tự (compile là việc CPU-bound trong 1 tab, gộp
     không giúp gì) nhưng publish theo lô 5 trang/request thay vì 1
     request/trang. Xác nhận sống: build 2 trang qua "Build all" → đúng 1
     `POST /api/pages-build` (`browser_network_requests`), không phải 2.
   - **Progress/resume**: `buildAll()` ghi hàng đợi (`{total, remaining}`)
     vào `localStorage` sau MỖI kết quả đã xác nhận (build lỗi/thiếu target,
     hoặc một lô publish thật sự thành công) - không bao giờ lạc quan xoá
     trước khi chắc chắn, nên tab đóng giữa MỘT lô publish để lại đúng
     những trang CHƯA xác nhận trong hàng đợi cho lần sau, không mất/không
     lặp. Mở lại trang thấy banner "Interrupted build" (Resume/Discard) nếu
     hàng đợi cũ còn sót. Bấm Build all mới luôn ghi đè hàng đợi bằng TOÀN
     BỘ danh sách trang - đúng yêu cầu gốc của mục này ("sửa layout.tsx gốc
     = build lại mọi trang"): staleness (`_page_deps`) không bắt được thay
     đổi CODE (chỉ content), nên "Build all" không được phép chỉ build
     những trang đang "Stale". Xác nhận sống: tự tạo hàng đợi dở dang qua
     `localStorage` (giả lập tab đóng giữa chừng) → banner hiện đúng "N của
     M trang" → Resume build nốt đúng các trang còn lại, banner biến mất;
     tạo lại hàng đợi khác → Discard xoá đúng, không build gì.
   - 3 test mới cho nhánh batch (`pages-build.test.ts`): publish nhiều trang
     đúng qua 1 lần gọi, lỗi 1 trang không kéo trang hợp lệ khác fail theo,
     body 1-trang cũ vẫn hoạt động y hệt.
6. **✅ Giai đoạn 6 - Sửa code trong browser - ĐỦ (2026-08-09).**
   `pagesSourceStorage` option + `scripts/sync-pages-r2.ts` (push/pull,
   không ghi đè) + `types-cache` cho `dry.generated.d.ts` (mục 10) đều đã
   xong từ trước. Phần còn thiếu - editor thật - đã xây xong:
   `routes/pages-source.ts` thêm POST/PUT/PATCH/DELETE (mirror gần như y
   hệt `routes/page-components.ts`), gate bằng `system-code` trong
   `handler.ts` (GET vẫn mở, vì `system-build`'s build flow cũng cần đọc);
   `PageEditor.tsx` (nav "System" → "Page Code Editor") - gần như bản sao
   cấu trúc của `PageComponents.tsx` (tái dùng nguyên `ComponentTreePanel`,
   không sửa gì), cộng thêm MỘT thứ mới: **panel preview qua iframe, theo
   từng trang, chạy CHÍNH `buildPage()` (hàm `PageBuild.tsx`'s nút Build
   gọi) trên source ĐANG SỬA (chưa lưu)**, `srcdoc` + `<base href>` để
   asset root-relative resolve đúng - không bao giờ gọi `publishBuiltPage`,
   nên không đụng `built/live/*`/`_pages`. Chỉ khả dụng khi file đang chọn
   CHÍNH LÀ `page.tsx` khớp 1 route tĩnh thật - resolve "layout/component
   dùng chung ảnh hưởng trang nào" chưa làm.
   **2 bug thật tìm thấy khi chạy sống (không phải lúc review code):**
   (1) race condition - 2 edit đủ gần nhau (trong lúc `buildPage()` VẪN
   ĐANG CHẠY, không chỉ trong cửa sổ debounce) khởi động 2 lần
   `refreshPreview()` chồng nhau, và không có gì đảm bảo cái NÀO XONG
   TRƯỚC thắng - sửa bằng token thứ tự (`previewSeqRef`), đúng mẫu
   `Editer.tsx`'s `sigSeq` đã dùng cho chính vấn đề này. (2) **nghiêm
   trọng hơn** - preview build ra HTML đúng, nhưng script hydrate nhúng
   sẵn trong đó (`#dry-hydrate-manifest`) trỏ `hydrate-built.ts` vào
   `${builtAssetsBaseUrl}/page.js` - tức bản đã PUBLISH THẬT qua Page
   Build trước đó, KHÔNG PHẢI bản đang sửa dở chưa lưu - nên ngay khi
   hydrate chạy xong, nó ÂM THẦM GHI ĐÈ preview đúng vừa render bằng bản
   cũ đã publish. Sửa: strip 2 script `dry-hydrate-manifest`/
   `dry-hydrate-params` khỏi HTML preview trước khi gán `srcdoc` -
   `hydrate-built.ts` đã tự no-op đúng khi không có manifest (case "trang
   tĩnh, không island" mục 7 vốn đã lo), nên preview thành bản TĨNH đúng,
   chỉ mất phần hydrate/tương tác - làm preview tương tác thật là việc
   riêng, chưa làm. **Xác nhận sống đầy đủ dưới `wrangler dev` thật**: mở
   tree thật (file thật từ các phiên trước), sửa `page.tsx` gốc, preview
   cập nhật đúng (xác nhận qua DOM, không chỉ suy luận từ ảnh chụp màn
   hình - ảnh chụp ban đầu GÂY HIỂU LẦM vì iframe preview bị cắt do chiều
   cao panel, không phải bug); tạo file MỚI hoàn toàn qua nút "New
   component" (`editor-test/page.tsx`), sửa nội dung, preview đúng, Save,
   sang Page Build thấy đúng "Not built", bấm Build, fetch `/editor-test`
   thật - ra ĐÚNG HTML đã soạn trong Page Editor, chứng minh trọn vòng
   "sửa trong browser → build → lên trang thật". Dọn sạch sau khi xác nhận
   (xoá cả file nguồn lẫn bản đã build).
7. **✅ mục 12 - CUTOVER THẬT, `page-handler.ts` không còn SSR sống ở prod
   nữa (2026-08-09).** Quyết định mới #8 (dưới đây) đã được HOÀN THÀNH, không
   còn "chờ" - `sivelap` (site đang chạy thật trong phiên này) giờ phục vụ
   TOÀN BỘ traffic ẩn danh từ `built/live/*`, không render gì cả.
   - Prod (`!isDev`), không có VEI session: đọc thẳng `readBuiltPage`
     (`built-pages-storage.ts`, hạ tầng mục 7 đã xây) theo pathname, không
     đọc `object_key` mỗi request (đúng thiết kế gốc). Miss → check
     `redirect` collection (như cũ) → 404 trần (`"Not found"`, không phải
     `404.tsx` styled). KHÔNG so version - trang cũ hơn nội dung thật (stale)
     vẫn tiếp tục phục vụ đến khi ai đó bấm Build lại; staleness hiện ở
     admin (`_pages.staleResource`), không hiện cho khách - đúng yêu cầu gốc
     "trang cũ tốt hơn trang mất", đạt được MIỄN PHÍ nhờ bỏ hẳn cơ chế so
     version cũ, không phải thêm logic mới.
   - `/sitemap.xml` cũng rẽ theo `isDev`: prod dùng
     `buildSitemapResponseFromRegistry` (mục 8), dev vẫn dùng
     `buildSitemapResponse` (query D1 trực tiếp) - bắt buộc đi cùng
     `page-handler.ts`'s cutover vì lý do ngược lại: nếu sitemap liệt kê
     một entry CHƯA từng build, URL đó sẽ 404 ngay khi search engine bấm
     vào - hai thứ phải phản ánh ĐÚNG CÙNG MỘT tập hợp "cái gì đang thật sự
     được serve".
   - **Dev (luôn luôn) VÀ một session VEI thật (cả dev lẫn prod) đi qua
     pipeline SSR sống y hệt trước mục 12, không đổi một dòng hành vi.**
     Đây là một sai lệch CÓ CHỦ ĐÍCH khỏi câu chữ gốc của mục 12 ("VEI chạy
     trên HTML tĩnh") - tìm ra khi ĐANG THIẾT KẾ (không phải khi build):
     `page-build.ts`'s pipeline render mọi `dryBind()` thành ref TRƠ (không
     có `data-dry-ref`, xem chính comment trong test của nó) - nghĩa là HTML
     tĩnh hiện tại không mang marker nào để overlay client-side bám vào cho
     trải nghiệm edit-từng-field (hover highlight, click-to-edit). Làm việc
     đó đúng nghĩa "VEI chạy trên HTML tĩnh" cần sửa thêm `page-build.ts` để
     GIỮ LẠI marker thay vì strip - **việc riêng, CHƯA làm, chưa lên kế
     hoạch cụ thể** - carve-out VEI là quyết định AN TOÀN để không phá vỡ
     tính năng edit đang chạy thật trong lúc chờ việc đó.
   - `pages-cache.ts`/`build-id.ts` (cơ chế `PageCacheEnvelope` cũ, đọc R2 +
     `JSON.parse` + so version D1 mỗi request) đã **xoá hẳn**, không giữ lại
     dù không dùng - không còn ai gọi tới sau cutover.
   - `sitemapEdgeCacheTtlSeconds` (mục 14) cũng được nối thật vào
     `entry-worker.ts` trong lượt này - `/sitemap.xml` giờ có TTL riêng, cap
     theo `_pages`'s lần publish kế tiếp thay vì phẳng 24h, tách khỏi cờ bật
     tắt cache trang thường.
   - **Bẫy thật tìm thấy khi VIẾT TEST (không phải khi build code):**
     Vitest's `mode` là `"test"`, và Vite định nghĩa `DEV` = `mode !==
     "production"` - nghĩa là `import.meta.env.DEV` đọc `true` dưới Vitest,
     y hệt dev server thật, KHÔNG CÓ CÁCH nào quan sát nhánh prod mới từ
     biến này. Test đầu tiên viết ra ÂM THẦM chạy sai nhánh (luôn luôn SSR
     sống) và fail với lỗi khó hiểu. Sửa bằng cách thêm tham số thứ 3
     `isDev` cho `handlePageRequest` (mặc định = `import.meta.env.DEV` thật
     - 3 call site thật KHÔNG đổi gì, chỉ test truyền tay `isDev` để chọn
     nhánh muốn kiểm).
   - **Xác nhận sống đầy đủ dưới `wrangler dev` thật** (D1+R2 thật, dùng lại
     2 trang đã build từ sớm trong phiên `/` + `/blogs/hello-world`): fetch
     ẩn danh `/` và `/blogs/hello-world` → 200, đúng byte HTML tĩnh (Tailwind
     đã inline sẵn, KHÔNG có `/@vite/client` hay đường dẫn dev source nào);
     fetch 1 path chưa từng build → 404 trần đúng "Not found"; `/sitemap.xml`
     đúng 2 URL kèm `<lastmod>` (dấu hiệu riêng của bản registry - bản D1
     trực tiếp cũ KHÔNG có `<lastmod>`). Quan trọng nhất: dùng Playwright
     bấm "Edit content" thật (qua `/dry/vei/enter`, cookie `drycms_vei`
     thật) rồi tải lại `/` - `dry-vei-config` script tag đổi đúng thành
     `{"edit":true}`, script src đổi từ `appsHydrateBuilt-*.js` (bootstrap
     riêng cho trang build tĩnh) sang `appsHydrate-*.js` (bootstrap SSR sống
     thường) - bằng chứng trực tiếp là carve-out ĐANG THẬT SỰ hoạt động,
     không phải suy luận từ code. Bấm Exit → quay lại đúng `edit:false` +
     `appsHydrateBuilt-*.js`. 0 lỗi console suốt toàn bộ chuỗi thao tác.
   - 6 test trong `page-handler.test.ts` (viết lại hoàn toàn, gồm cả sửa 1
     test CÓ SẴN TỪ TRƯỚC vốn đã sai ngay từ đầu - `/blogs/[slug]/page.tsx`
     chưa từng thật sự tồn tại trong repo, chỉ từng được push thẳng lên R2
     test ở phiên trước, xác nhận bằng cách chạy lại đúng test đó trên code
     GỐC trước khi sửa gì - baseline cũng fail y hệt). Suite đầy đủ: 0 fail
     mới, cùng nhóm fail cũ không liên quan (giảm từ 13 xuống 12 vì
     `pages-cache.test.ts` bị xoá cùng file).

8. **✅ mục 12 - "Sau `saveAll()` thì chạy build cho trang hiện tại + trang
   phụ thuộc" (2026-08-09).** Phần còn thiếu của mục 7 ở trên - cutover phía
   ĐỌC đã xong, nhưng chưa có gì tự động cập nhật trang tĩnh sau một lần VEI
   save; thiếu nó thì site tĩnh "cũ" mãi cho tới khi ai đó bấm Build tay.
   - `pages-build.ts` GET thêm nhánh `?byResource=a,b` (dùng lại
     `PagesRegistryAdapter.listPathsByResource`, đã có sẵn từ mục 5, chưa
     route nào gọi tới) - trả union các path phụ thuộc vào những resource đó,
     gate sẵn theo `system-build` (cùng cờ mọi method khác của route này đã
     có, không cần sửa `handler.ts`).
   - `PageBuild.tsx` thêm hiệu ứng đọc `?autoBuild=/a,/b` trên URL của chính
     nó: một khi `sourceByPath`/`allTypes`/`assetHrefs`/`targets` đã sẵn sàng
     (cờ `ready` mới, tách khỏi suy luận từ dữ liệu rỗng - trang không có gì
     để build vẫn phải phân biệt được với "đang load"), tự chạy `buildOne()`
     cho từng path rồi `postMessage({type:"vei:build-done"})` lên
     `window.parent`. `buildOne` đổi sang trả `Promise<boolean>` (trước đó
     nuốt lỗi, không có tín hiệu thành/bại cho code gọi nó).
   - `overlay.ts`'s `saveAll()`: sau vòng lặp `saveTarget` (không đổi), thêm
     `rebuildAffectedPages(resources)` - fetch `?byResource=`, rồi TRỎ LẠI
     CHÍNH iframe ẩn `agent` mà `saveTarget` vừa dùng (không tạo iframe mới)
     sang `page-build?autoBuild=...`, đợi `vei:build-done` (timeout
     `20s + 15s×số trang`, giống tinh thần timeout 30s có sẵn của
     `saveTarget`) rồi mới `window.location.reload()`. Không bao giờ throw -
     thiếu `system-build`, mất mạng, build kẹt đều chỉ khiến hàm này resolve
     và `saveAll` rơi về hành vi cũ (reload trần, không rebuild).
   - **Bẫy thật tìm thấy khi LIVE-VERIFY, không phải lúc viết code:** cả 2
     nửa (`?byResource=`, `?autoBuild=`) đều đúng khi gọi tay/mở thẳng URL,
     nhưng gọi từ trong `saveAll()` thì trang reload gần như ngay lập tức -
     quá nhanh để một build thật (compile + render + Tailwind trong iframe
     cô lập) kịp chạy xong. Nguyên nhân: `saveTarget`'s save-qua-iframe-ẩn
     khiến `ContentEntryEditor.handleSave` xoá draft khỏi `entry-draft-db`,
     và việc xoá đó phát `BroadcastChannel` "delete" - CHÍNH overlay này
     cũng đang lắng nghe kênh đó (`subscribeEntryDraftChanges`, để đồng bộ
     multi-tab) và trước giờ vẫn `window.location.reload()` ngay khi thấy
     draft của 1 target đang hiện bị xoá, KHÔNG phân biệt được "xoá vì tab
     khác save" với "xoá vì CHÍNH `saveAll()` này đang chạy". Trước mục 12
     race này vô hại (`saveAll()` cũ cũng reload ngay sau vòng lặp, kết quả
     giống nhau) - mục 8 mới làm lộ ra vì giờ có việc Ý NGHĨA cần chạy giữa
     lúc save xong và lúc reload. Sửa bằng cờ `saveAllInFlight` (đặt `true`
     trước vòng lặp save, `false` sau khi `rebuildAffectedPages` xong hoặc
     khi có target lỗi) - listener bỏ qua reload-của-chính-nó trong lúc cờ
     bật, các cross-tab case thật (tab khác save/discard) không đổi gì.
   - **Xác nhận sống dưới `wrangler dev` thật:** viết thêm 1 field `dry()`-
     bound thật (`dryBind(post.$.title)`) vào `page.tsx` gốc (cả bản trong
     git lẫn bản trong `pagesSourceStorage`, 2 nơi tách biệt hoàn toàn - xem
     mục 13/quyết định #6; VEI's SSR sống đọc `import.meta.glob` ở git, build
     tĩnh đọc `pagesSourceStorage`, KHÔNG có gì tự động đồng bộ 2 nơi này)
     rồi build lại worker để VEI thấy marker thật. Bấm "Edit content" →
     sửa Title qua dialog thật → Cancel (không mất draft) → bấm Save ở dock →
     đợi (build thật mất ~8-12s do Tailwind compile trong iframe cô lập, lúc
     đầu tưởng nhầm là fail vì kiểm tra sớm quá) → `curl` ẩn danh trang `/`
     thấy ĐÚNG title vừa sửa, không cần bấm Build tay. Dọn dẹp: revert cả 2
     bản `page.tsx` (git `checkout --`, Page Editor ghi lại nguyên văn), sửa
     lại title blogPost về `"Hello World"`, Build all lại để trang tĩnh khớp
     nguyên trạng, rebuild worker lần cuối cho khớp git.
   - 3 test mới `pages-build.test.ts` (route `?byResource=`, SQLite registry
     thật qua `createPagesRegistryAdapter`, không mock). Suite đầy đủ sau
     thay đổi: 1072 pass / 12 fail (cùng nhóm fail cũ không liên quan, tăng 3
     so với trước vì test mới).
   - **Phát hiện phụ ở lượt này, SỬA XONG cùng ngày (2026-08-09, xem mục 9
     bên dưới):** một trang dùng `dry()`/`params()` ở top-level thì bản ĐÃ
     BUILD hydrate lỗi `ReferenceError: dry/params is not defined` - client
     bundle không expose 2 global đó cho code đã compile. Lúc phát hiện tưởng
     là việc riêng ngoài phạm vi (lỗi console, không chặn SSR/VEI/rebuild),
     nhưng hoá ra chỉ cần sửa đúng 1 file (`hydrate-built.ts`) - xem mục 9.

9. **✅ Sửa bug hydrate `dry`/`params`/`setTitle`/`dryBind` "not defined"
   (2026-08-09, phát hiện ở mục 7/8 phía trên).** Gốc rễ: `page.tsx`/
   `layout.tsx` gọi 4 hàm này như ambient global thật (`dry.generated.d.ts`'s
   `declare global`), và có ĐÚNG 3 nơi phải tự lo việc đó hoạt động đúng
   theo NGỮ CẢNH thật thi hành - server SSR/`hydrate-client.ts` dựa vào
   `app-router-plugin.ts` (Vite plugin, tự chèn `import` đúng theo
   `consumer === "server"|"client"`); `page-build.ts`'s `evalModule` (render
   TRONG LÚC build, ở tab admin) truyền cả 4 làm PARAMETER của
   `new Function(...)`. `compileEsmAsset` (biên dịch RIÊNG cho
   `page.js`/`layout.js` PUBLISH ra ngoài, để trình duyệt KHÁCH hydrate) lại
   không làm gì cả - không qua Vite (không có bước AST-inject import), không
   qua `new Function` (là ESM thật, `import()` thẳng) - nên 4 identifier đó
   cứ thế trơ ra trong output, ai gọi tới là `ReferenceError`.
   - Sửa ở `hydrate-built.ts`, KHÔNG đụng `compileEsmAsset`: file này vốn đã
     đọc đúng `#dry-replay-data`/`#dry-hydrate-params` và gọi
     `setReplayLog`/`setCurrentParams` (cơ chế replay CÙNG cơ chế
     `dry-reader-client.ts`/`hydrate-client.ts` cũ dùng - `buildDocument()`
     dùng chung, nên bản build app-r2 CŨNG nhúng đúng `#dry-replay-data`) -
     chỉ thiếu bước gán 4 hàm đó lên `window` TRƯỚC khi `import()` module
     page/layout đã biên dịch. Một identifier không khai báo trong BẤT KỲ
     module nào (kể cả ES module thật) vẫn rơi xuống global scope khi đọc -
     ngữ nghĩa JS chuẩn, không phải hack. `dryBind` an toàn gán thẳng (không
     cần biến thể riêng): giá trị replay luôn mang ref TRƠ
     (`createInertRefProxy`), y hệt lúc build gốc (build không chạy ở VEI
     edit mode) - nên `dryBind()` trả `{}` cả 2 lần, không có gì lệch giữa
     SSR gốc và hydrate.
   - Xác nhận sống dưới `wrangler dev` thật: trước khi sửa, `/` VÀ
     `/blogs/hello-world` đều lỗi console đúng như mô tả. Sau khi sửa + build
     lại: 0 lỗi console cả 2 trang, `window.dryHydrated === true`,
     `typeof window.dry/params/setTitle/dryBind === "function"` xác nhận
     trực tiếp qua `browser_evaluate`.

**Quyết định mới #8 (chốt trong lúc build, không có trong bản plan gốc):**
mọi capability trên được xây **additive và dark** cho tới khi có ít nhất 1
lần build thật chạy qua UI Build (mục 5) - **điều kiện đó đã đạt được**
(2026-08-09, xem mục 7 ở trên), nên cutover đã được thực hiện đúng như quyết
định này dự tính, không phải bỏ qua nó. Lý do gốc: site `sivelap` đang chạy
thật - flip sớm khi `_pages` còn rỗng sẽ làm site 404/sitemap rỗng ngay khi
deploy. Chi tiết đầy đủ trong `status/app-r2-build.md`.

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
