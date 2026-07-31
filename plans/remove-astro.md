# Bỏ Astro — drycms trở thành app Preact độc lập

## Hiện trạng (đã khảo sát code)

`drycms` hiện là một **Astro integration** (`packages/drycms/src/integration/integration.ts`):

- Đăng ký renderer `@astrojs/preact` hộ consumer.
- `injectRoute` 7 route vào Astro: 1 catch-all (`app.astro`, mount Preact SPA) + 6 API
  route thuần (`storage.ts`, `icons.ts`, `iconify.ts`, `content-types.ts`,
  `content-entries.ts`, `richtext-components.ts`) — mỗi route dùng kiểu `APIRoute`/
  `APIContext` của Astro (thực ra rất gần Fetch API chuẩn: nhận request, trả `Response`).
- Ép `output: "server"` vì admin UI là SPA `client:only` — **không có SSR thật**,
  `app.astro` chỉ in ra 1 HTML shell tĩnh rồi `<App client:only="preact" />`.
- Bơm config (`path`, `storage`, `icons`, `content`, `richtext`) vào các route/route
  qua **virtual module của Vite** (`virtual:drycms/*-config`, xem `integration/virtual.ts`)
  vì Astro không có cách nào khác truyền props vào 1 injected route.
- `import.meta.glob` cho richtext components cũng phải đi qua 1 virtual module vì
  glob pattern phải là literal source do chính Vite biên dịch.
- Root repo hiện tại (`astro.config.mjs`, `src/pages/index.astro`, `src/dry-components/*`)
  chỉ là 1 demo Astro app gần như rỗng, không dùng thật drycms.

Routing phía client (`src/routers/App.tsx`) đã 100% dùng `preact-iso`, độc lập với Astro
từ trước — đây là phần **không cần viết lại**.

## Quyết định đã chốt với user

1. **Không giữ root app Astro riêng.** `packages/drycms` sẽ *trở thành* root app luôn
   (gộp cấu trúc lại), không còn khái niệm "thư viện cài vào project Astro khác". Tham khảo
   cấu trúc của `npx create vite preact` (index.html + vite.config.ts + src/main.tsx) làm
   khung sườn.
2. **Không viết SSR thật.** Giữ nguyên cách hiện tại: server chỉ serve 1 HTML shell tĩnh +
   bundle JS, `preact-iso` lo toàn bộ routing phía client như bây giờ.
3. Server chạy qua **1 lớp adapter**, mặc định là **Node**; thiết kế interface đủ tổng quát
   để sau này thêm Worker (Cloudflare) và Bun mà không phải sửa phần xử lý route.
4. Việc dọn các thư mục/file thừa (root `astro.config.mjs`, `src/pages/index.astro`,
   `packages/drycms/src/integration/*`, deps `astro`/`@astrojs/preact`, ...) chỉ làm **sau
   khi** cấu trúc mới đã chạy được, không xoá song song với lúc chuyển đổi.

## Giả định cần user xác nhận lại (đánh dấu rõ vì ảnh hưởng lớn)

- **drycms không còn là npm package cho project khác cài vào** — repo này tự nó là app CMS
  hoàn chỉnh (giống mã nguồn Strapi tự host), người dùng fork/clone rồi sửa 1 file config +
  `.env`, không `npm install drycms` vào project khác nữa. Nếu sai giả định này (vẫn muốn
  giữ khả năng "cài vào project khác" như 1 thư viện) thì thiết kế `server/` bên dưới cần
  đổi hướng khác (export 1 factory thay vì có sẵn 1 app chạy được).
- `componentsDir` (thư mục richtext components, hiện cấu hình được qua option) sẽ **cố định**
  là `src/dry-components` trong chính repo này thay vì đọc từ 1 "consuming project" khác —
  hệ quả trực tiếp của giả định trên.

## Kiến trúc đề xuất sau khi chuyển đổi

```
/ (root — chính là drycms)
├── index.html                 # Vite entry, thay app.astro
├── vite.config.ts             # thay astro.config.mjs, dùng @preact/preset-vite
├── dry.config.ts              # nơi khai báo path/storage/icons/content/richtext
│                               # (thay props truyền vào dry() cũ)
├── src/
│   ├── main.tsx                # mount <App/> vào #app — thay app.astro + client:only
│   ├── routers/App.tsx          # GIỮ NGUYÊN gần như 100% (đổi 1 chỗ: import config
│   │                            #   runtime thay vì `virtual:drycms/config`)
│   ├── components/, pages/, store/, hooks/, lib/, storage/, content-types/,
│   │   icons/, styles/          # GIỮ NGUYÊN, chỉ sửa import nếu đụng virtual:*/astro
│   └── server/                  # MỚI — toàn bộ tầng server độc lập Astro
│       ├── config.ts            # thay virtual:drycms/*-config: đọc dry.config.ts +
│       │                        #   .env lúc khởi động server, expose 1 lần
│       ├── handler.ts           # 1 hàm (request: Request, env) => Promise<Response>
│       │                        #   gộp 6 route hiện có thành 1 router nội bộ
│       │                        #   (tự viết match pattern, thay injectRoute)
│       ├── static.ts            # serve HTML shell + asset build (đổi theo adapter)
│       └── adapters/
│           ├── types.ts         # interface DryAdapter chung
│           ├── node.ts          # mặc định — http.Server, dùng cho dev (vite middleware
│           │                    #   mode) và production build
│           ├── worker.ts        # (sau này) Cloudflare Workers fetch handler
│           └── bun.ts           # (sau này) Bun.serve
└── e2e/, *.test.ts               # cập nhật baseURL/port, không còn phụ thuộc `astro dev`
```

### Điểm kỹ thuật quan trọng khi chuyển từng phần

- **6 route API** (`routes/*.ts`): logic nghiệp vụ bên trong giữ nguyên gần như 100%
  (đã dùng `Response`/`StorageError`/`jsonResponse` thuần). Chỉ đổi:
  - `APIRoute`/`APIContext` (astro) → kiểu tự định nghĩa trong `server/handler.ts`
    (`{ request: Request, params: Record<string,string> }`).
  - `import { storage } from "virtual:drycms/storage-config"` → `import { storage } from
    "../server/config.js"` (hoặc gọi 1 hàm `getConfig()`).
  - `route-helpers.ts`'s `readSlug(context: APIContext)` đổi sang nhận `params` thuần.
- **`content-types/engine/d1.ts`**: hiện đọc `context.locals.runtime.env` (đặc thù
  `@astrojs/cloudflare`). Interface `DryAdapter` cần có 1 field kiểu
  `env: Record<string, unknown>` (Node: `process.env`; Worker sau này: `env` param của
  `fetch(request, env, ctx)`) để chỗ này không phải viết lại 2 lần.
- **`virtual:drycms/richtext-components` (import.meta.glob)**: vì `componentsDir` giờ cố
  định trong chính repo, có thể viết thẳng
  `import.meta.glob('/src/dry-components/*/index.tsx')` trong code thật, không cần virtual
  plugin nữa — Vite (không qua Astro) vẫn xử lý glob y hệt.
- **Dev server**: dùng `vite.createServer({ server: { middlewareMode: true } })` gắn vào
  1 `http.createServer` của Node — request khớp `${path}/api/**` thì đi qua
  `server/handler.ts`, còn lại nhường cho Vite middleware (HMR, phục vụ `index.html` +
  module dev). Đây là pattern chuẩn của Vite khi tự viết server (không cần Astro).
- **Production build**: `vite build` ra `dist/client` (giống hiện tại `tsc` build nhưng giờ
  build luôn cả UI thay vì chỉ biên dịch `.ts`), rồi `server/adapters/node.ts` serve tĩnh
  `dist/client` + gắn `handler.ts` cho `${path}/api/**`.
- **`env.d.ts`**: bỏ toàn bộ `declare module "virtual:drycms/*"`.

## Việc sẽ xoá (chỉ làm ở bước dọn dẹp cuối, sau khi cấu trúc mới chạy ổn)

- `astro.config.mjs`, `src/pages/index.astro` (root)
- `packages/drycms/src/integration/` (integration.ts, options.ts phần Astro-only, virtual.ts
  + 2 file test tương ứng)
- `packages/drycms/src/app.astro`
- Dependency `astro`, `@astrojs/preact` khỏi mọi `package.json`
- Cấu trúc workspace `packages/drycms` (nếu quyết định gộp thẳng vào root thay vì giữ dạng
  workspace — cần xác nhận thêm khi tới bước này)

## Thứ tự triển khai

1. Dựng khung Vite+Preact ở root (`index.html`, `vite.config.ts`, `src/main.tsx`) chạy song
   song, CHƯA đụng gì tới code cũ — xác nhận `bun run dev` (vite thuần) lên được trang trắng.
2. Viết `server/config.ts` + `server/handler.ts`, chuyển từng route trong 6 route hiện có
   sang, giữ nguyên logic, chỉ đổi lớp nhận/trả request.
3. Viết `server/adapters/node.ts` + gắn vào dev server (middleware mode) và 1 script build
   production.
4. Copy/sửa `App.tsx` (bỏ `virtual:drycms/config`), `main.tsx` mount app (thay `app.astro`).
5. Rà toàn bộ `components/`, `pages/`, `lib/`, `storage/`, `content-types/`, `icons/` — sửa
   nốt các import còn dính `astro`/`virtual:*` (danh sách đầy đủ đã liệt kê ở phần khảo sát
   phía trên, đa số chỉ là comment, không phải code thật).
6. Cập nhật `vitest` config + `playwright.config.ts` (đổi baseURL/port, đổi cách khởi động
   dev server — không còn `astro dev --background`).
7. Chạy full test (unit + e2e) + smoke test thủ công trên trình duyệt (dashboard, showcase,
   media, content-types, richtext, icon management — theo đúng checklist QA đang dùng).
8. Dọn dẹp: xoá các file/dep liệt kê ở mục trên, cập nhật `CLAUDE.md`.
9. Tạo branch `master`, commit, **xin xác nhận trước khi `git push`**.

## Rủi ro / điểm cần cẩn thận

- `dryDepAliases`/`preactAliases` trong `integration.ts` tồn tại để giải quyết vấn đề
  resolve bare specifier khi `drycms` là nested dependency của consumer project. Nếu drycms
  không còn là dependency của ai khác (chính nó là root), phần lớn cơ chế alias này **hết
  cần thiết** — nhưng cần double-check `optimizeDeps`/prebundle vẫn ổn với Vite thuần.
- `dry.config.ts` mới thay cho object option `dry({...})` — cần giữ đúng semantics
  default (`path: "/dry"`, `storage.kind: "local"`, v.v.) như `resolveOptions()` hiện tại.
- Đổi cổng dev server (Vite default 5173 thay vì Astro 4321) → phải sửa `playwright.config.ts`
  và mọi chỗ hardcode (đã kiểm tra: e2e spec không hardcode port, chỉ `playwright.config.ts`).

---

**Chưa code gì ở bước này.** Đợi bạn duyệt plan trên (hoặc sửa lại phần giả định/kiến trúc)
rồi mới bắt đầu triển khai theo đúng thứ tự 9 bước ở trên.
