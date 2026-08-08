# App R2 - trang public build sẵn, server không SSR

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

## Quyết định user đã chốt

1. **Admin là builder duy nhất.** Trang chưa build thì chưa tồn tại. Không
   có fallback SSR ở server, không cron, không queue nền.
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
           │                                    ├─► HTML  ─┐
           │                                    ├─► page.js ├─► storage API ─► R2 / đĩa local
           │                                    └─► CSS    ─┘
```

### Đường serve (worker/node)

```
GET /about ─► pages-cache đọc R2 ─► trả HTML ─► browser tải page.js + CSS ─► hydrate
```

Không D1 query, không render, không compile. Miss = 404 thật.

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
| Compile TSX→JS trong browser + mini module system | [`src/page-components/sucrase-eval.ts`](../src/page-components/sucrase-eval.ts) |
| Rewrite import specifier | [`src/page-components/import-rewrite.ts`](../src/page-components/import-rewrite.ts) |
| Editor code + typecheck TS trong browser | [`src/components/Editer/`](../src/components/Editer/) |
| Resolve route → vnode (dùng chung server/client) | [`resolve-match.ts`](../src/server/app-router/resolve-match.ts) |
| Match path → route + params | [`match.ts`](../src/server/app-router/match.ts), [`route-tree.ts`](../src/server/app-router/route-tree.ts) |
| Lưu/đọc HTML theo pathname trên R2 | [`pages-cache.ts`](../src/server/app-router/pages-cache.ts) |
| Serve từ cache | [`page-handler.ts:102`](../src/server/page-handler.ts#L102) |
| Theo dõi phụ thuộc `page → content-type` | `touchedTypes` trong `page-handler.ts`, `versions` trong `PageCacheEnvelope` |
| So version để biết stale | `entries.getResourceVersions(types)` |
| Ghi file qua HTTP + adapter local/R2 | [`routes/storage.ts`](../src/server/routes/storage.ts), [`storage-adapters.ts`](../src/server/storage-adapters.ts) |

Nói cách khác: **nửa "serve" của kế hoạch này gần như đã xong**. Việc chính
là đảo chiều người đổ đầy cache - từ pull (server SSR khi miss) sang push
(browser đẩy lên khi save).

## Phải xây

### 1. `buildDocument()` - tách phần dựng `<head>`/`<body>` ra khỏi stream

`render.ts` hiện trộn "dựng document" với "stream response". Tách ra một hàm
thuần `buildDocument(vnode, ctx) → string` để cả server (nếu còn cần) lẫn
browser builder gọi chung. `ctx` phải chứa **origin tường minh** - build
chạy ở tab admin (`localhost:5173`) trong khi site là `https://…`, mà
`canonical`/`og:url`/`resolveImageSrc` đều phụ thuộc origin. Không được lấy
`window.location`.

### 2. `dry()` bản thứ ba: đọc qua HTTP

Hiện có `dry-reader.ts` (server/D1) và `dry-reader-client.ts` (replay). Build
trong browser cần bản đọc qua HTTP API.

**Bắt buộc: ép published-only ở phía server, không tin session.** Browser
đang đăng nhập admin, nếu để API trả cả draft/scheduled thì bản nháp bị nướng
thẳng vào HTML public trên R2. `isPublished()` (`dry-populate.ts:56`) là
điều kiện phải áp ở endpoint build, không phải ở client.

Bản này vẫn phải sinh `callLog` y như bản server để nhúng replay data cho
hydration (`dry-replay-codec.ts`).

### 3. Liệt kê param cho route động

`/blogs/[slug]/page.tsx` muốn build sẵn thì phải biết hết slug. Query danh
sách slug từ collection tương ứng lúc build (kiểu `generateStaticParams`).
Route catch-all `[...rest]` thì không liệt kê được - phải khai báo tay hoặc
chấp nhận không build.

### 4. Index ngược `content-type → pages`

`touchedTypes` đã được tính sẵn khi render, chỉ thiếu chiều ngược lại. Build
xong một trang thì ghi luôn vào một manifest trong KV:

```
{ "blog": ["/", "/blogs", "/blogs/abc", …], "settings": ["/", …] }
```

Sửa 1 entry `blog` → tra manifest → biết chính xác cần build lại trang nào.

### 5. Tailwind build trong browser

`globals.css` hiện build lúc build-time bằng cách scan source. User thêm
class mới trong browser thì không có CSS tương ứng. Dùng `@tailwindcss/browser`
(v4) ngay trong bước build: scan toàn bộ `.tsx` trong tree → sinh CSS →
content-hash → lưu R2. HTML phải trỏ đúng phiên bản CSS đó (`assets.ts`'s
`GLOBALS_CSS_HREF` hiện là hằng số bake lúc build client - cần thành giá trị
đọc từ manifest build).

### 6. Hydration từ `.js` động

`hydrate-client.ts` đang dò route bằng `import.meta.glob` trong bundle. Đổi
sang: đọc manifest route + `import("/…/page.js")` động. Phía browser chạy ESM
động **không cần eval**, nên phần này dễ. Nhưng import trong page
(`preact/hooks`, `../../dry.generated.js`) phải resolve được → import map
trong `<head>`, hoặc rewrite specifier lúc compile (`import-rewrite.ts` đã
làm việc tương tự).

Tối ưu đáng làm: trang không có island tương tác thì bỏ hẳn hydration - gắn
cờ per-page lúc build.

### 7. UI Build trong admin

- Danh sách trang + trạng thái: đã build / stale / chưa build. Stale phát
  hiện bằng cách so `versions` trong `PageCacheEnvelope` với
  `getResourceVersions()` - máy móc đã có sẵn.
- Nút "Build lại trang này" / "Build tất cả".
- Progress + resume được (sửa `layout.tsx` gốc = build lại mọi trang; đóng
  tab giữa chừng là chuyện sẽ xảy ra).
- Batch PUT lên storage, đừng 500 request rời rạc.

### 8. Sửa `page-handler.ts`

- Prod (`!import.meta.env.DEV`): chỉ đọc cache, bỏ nhánh render. Miss = 404.
  Dev đi tiếp nhánh SSR hiện tại, không đụng vào.
- **Ở prod, VEI không còn bypass cache được** (không còn SSR để bypass
  sang). VEI chạy trên HTML tĩnh + overlay patch DOM phía client -
  `applyPendingDrafts()` đã làm đúng việc đó rồi. Sau `saveAll()` thì chạy
  build cho trang hiện tại + trang phụ thuộc, xong mới
  `window.location.reload()`. Ở dev, VEI vẫn bypass + SSR như cũ.
- Stale (version lệch) thì **vẫn trả HTML cũ**, không 404. Trang cũ tốt hơn
  trang mất. Staleness báo trong admin, không báo cho khách.

### 9. Version + rollback

R2 không có versioning mặc định. Hai admin cùng build sẽ ghi đè nhau kiểu
last-writer-wins.

- v1: ghi đè tại chỗ (build do admin chủ động, hiếm, chấp nhận được).
- Khi cần: ghi vào `pages/<buildHash>/…` bất biến + một con trỏ trong KV.
  Đổi con trỏ = switch nguyên tử, và được rollback tức thì miễn phí. Cũng là
  cách chữa trường hợp build dở giữa chừng làm site nửa mới nửa cũ.

## Rủi ro đã chấp nhận (hệ quả của quyết định #1)

- **Ghi không qua browser thì không lên trang.** `bun run seed:pages`, HTTP
  API, tích hợp ngoài, admin khác... đều làm site stale âm thầm. Giảm nhẹ
  bằng mục 7 (hiện trạng thái stale trong admin) - biến "sai âm thầm" thành
  "sai nhìn thấy được".
- **`schedule` không tự lên bài.** Feature `schedule` (`system-fields.ts:150`,
  opt-in per content-type) publish bài bằng *thời gian trôi qua*, không có
  sự kiện ghi nào để bắt. Không ai build lúc 9h sáng thì bài không lên.
  Schema hiện tại chưa type nào bật `schedule` nên hôm nay là moot; nếu bật
  sau này thì phải nói rõ trong UI rằng `schedule` chỉ có tác dụng khi có
  build sau thời điểm đó.
- **Mất typecheck/test trên code prod.** Code sửa trong browser không qua
  `tsc`/`vitest`/e2e. `Editer/ts-worker.ts` đỡ được phần typecheck, phần còn
  lại thì không.
- **Ai sửa được page = chạy được code** (trong browser admin, không phải trên
  server - nhẹ hơn nhiều so với bản SSR). Vẫn nên gate bằng permission riêng
  kiểu `system-code`, theo mẫu `system-vei`.
- **`.tsx` là source of truth, `.js` chỉ là cache.** Không tin `.js` client
  gửi lên như thứ độc lập - phải luôn compile lại được từ `.tsx`.

## Giai đoạn

**Spike trước (nửa buổi, chưa cam kết gì):** dựng 1 trang tĩnh đơn giản
(`/about`) đi hết đường: compile `.tsx` bằng sucrase trong browser →
`resolveMatchToVNode` → `renderToStringAsync` → PUT HTML lên storage → worker
serve. Chứng minh được hoặc chết ở đây. Đo luôn thời gian build 1 trang.

1. **Build core** - `buildDocument()` tách ra, `dry()` HTTP published-only,
   build 1 trang tĩnh, ghi qua storage adapter. Serve từ cache, miss = 404.
2. **Route động + manifest** - liệt kê param, index ngược
   `content-type → pages`, build theo phụ thuộc.
3. **CSS + hydration** - Tailwind browser build, `page.js` động + import map,
   cờ bỏ hydration cho trang tĩnh.
4. **UI Build + VEI** - trang Build trong admin (trạng thái/stale/progress/
   resume), VEI save → build → reload.
5. **Sửa code trong browser** - editor cho `src/**/*.tsx`, lưu R2, build lại
   trang liên quan. (Đây là mục tiêu cuối, nhưng là phần *dễ nhất* một khi
   1-4 xong - nó chỉ là thêm một nguồn trigger build.)

## Câu hỏi còn mở

- Full rebuild dùng ghi đè tại chỗ hay thư mục bất biến + con trỏ KV? (mục 9
  - đề xuất: tại chỗ cho v1)
- Route `[...rest]` xử lý sao - khai báo path tay, hay không hỗ trợ?
- Trang Build trong admin có hiện ở dev không? (build được nhưng dev không
  đọc cache nên không thấy kết quả - đề xuất: vẫn hiện, ghi xuống đĩa local,
  xem kết quả qua `dev:worker`)

~~Có giữ live preview Vite ở dev không?~~ → **Đã chốt: dev giữ nguyên hoàn
toàn, cơ chế này chỉ bật ở server thật.**
