# Xây dựng hệ thống reader từ content type metadata

Reader = lớp đọc content cho `src/apps` (App Router - xem `plans/app-router.md`),
sinh type tự động từ `ContentTypeDefinition[]` nên page code có autocomplete +
type-check thật, không phải `any`.

## Trạng thái (2026-08-04)

**Giai đoạn 1, 2, 3 đã code+test xong** (engine query layer, codegen, runtime
`dry()` gọi qua import trực tiếp). **Giai đoạn 4 (nối vào App Router) chưa làm
được gì** - không có gì để nối vào, `src/apps` vẫn trống, App Router còn ở dạng
ý tưởng (`plans/app-router.md`). Chi tiết từng phần + những chỗ lệch so với kế
hoạch gốc nằm trong mục tương ứng dưới đây. `plans/remove-file-engine.md` (điều
kiện tiên quyết) đã xong trước đó cùng ngày.

## Ý tưởng gốc

```tsx
const { email } = dry().collection("user", /* id or slug */)
const {} = dry().singleton("", ...)
```

- Khi save content meta sẽ sinh ra file type để làm việc này.
- Sinh `.d.ts` (hoặc JSON Schema) từ metadata; `dry` là hàm có sẵn trong global.

## Quyết định đã chốt

1. **API async** (phương án A). Đã sửa `plans/app-router.md` dòng "sync
   functions" → async để khớp.
2. **Chỉ `sqlite` + `D1`.** Engine `file` đã gỡ (`plans/remove-file-engine.md`).
3. Backend `github`/`gitlab` không còn tồn tại → reader được phép đọc nhiều
   lần trong một lần render, không cần lo "1 read = 1 API call chậm".

## Bề mặt API - như đã build

```ts
const post     = await dry().collection("post").get("my-slug")   // id | slug
const posts    = await dry().collection("post").list({ where: [...], sort, page, pageSize, includeDraft })
const settings = await dry().singleton("settings").get()
```

- `collection(name)`/`singleton(name)` nhận tên type, kiểm tra `kind` đúng và
  tồn tại, throw message rõ nếu sai (`dry-reader.ts`'s `mustFindType`) - hữu
  ích khi `.d.ts` chưa kịp regenerate sau một đổi schema.
- `get()` **luôn** published-only, không có tham số bật draft - nếu cần xem
  draft (preview mode), đó là việc của Giai đoạn 4 (chưa làm). `list()` có
  `includeDraft` (mặc định `false`) vì có tình huống hợp lệ hơn (sitemap, trang
  editorial) cần thấy hết.
- **Lệch so với bảng gốc ở Giai đoạn 2**: `relation`/`relationmirror` được sinh
  type là `number | null`/`number[]` (id thô), **không** phải interface của
  type đích (`Post`) như bảng dự kiến ban đầu. Lý do: `getEntry`/`findEntry`
  hiện tại (kể cả sau khi tôi thêm `findEntry`) chỉ trả id/id[] cho quan hệ,
  không tự populate/join sang record đích - sinh type là `Post` sẽ hứa hẹn một
  shape runtime không thực sự trả về. Có comment `// relation -> <target
  name>` cạnh field để dev biết trỏ đi đâu. Muốn có object đã populate thật thì
  cần thêm `populate` ở tầng engine (join/N+1 query) trước, chưa làm.
- `password`/`secretkey` bị loại khỏi interface hoàn toàn (không emit field),
  đúng như dự kiến.

## Giai đoạn 1 - Bổ sung query cho engine (sqlite + D1) - XONG

File mới: `src/content-types/engine/entry-where.ts` - thuần (không đụng
driver), export `EntryWhere`/`EntryWhereCondition`/`buildWhereClause`/
`buildPublishedOnlyClause`/`combineWhereClauses`, dùng chung bởi cả
`entries-sqlite.ts` và `entries-d1.ts` (theo đúng tiền lệ `entry-tree.ts` đã có
sẵn: logic thuần thì share, code đụng driver thì duplicate - xem comment trong
`entries-d1.ts` giải thích lý do duplicate CRUD).

**Lệch so với kế hoạch**: `EntryWhere` là **danh sách điều kiện AND phẳng**
(`EntryWhereCondition[]`), không phải cây AND/OR như chữ "cây điều kiện" gốc
gợi ý - chưa có caller nào cần OR, thêm cây lồng nhau lúc này là over-engineer.
Có thể mở rộng thành cây sau mà không phá API hiện tại.

Đã thêm:
- `QueryableColumn.fieldId` (`entry-tree.ts`) - cần để `buildPublishedOnlyClause`
  nhận diện đúng cột hệ thống `draft`/`schedule` bằng id, không phải tên (cùng
  rủi ro `EntryColumnNode.fieldId`'s doc comment đã cảnh báo: field tuỳ ý cũng
  có thể tên là "draft").
- `ContentEntryEngineAdapter.findEntry(type, allTypes, where, {publishedOnly?})`
  - lookup 1 dòng theo where, populate đầy đủ như `getEntry`, `ORDER BY id ASC
  LIMIT 1` để deterministic khi where khớp nhiều dòng.
- `EntryQuery.where`/`.publishedOnly` cho `listEntries`.
- "Published" = `(draft IS NULL OR draft = 0) AND (schedule IS NULL OR
  schedule <= now)` - `NULL` tính là published vì field chưa từng bị set
  (default `null`, không phải `false`) vẫn phải hiện ra.

**Test**: `entries-sqlite.test.ts` (+3 test case), và file test D1 hoàn toàn
mới `entries-d1.test.ts` (D1 chưa từng có test nào trước đây) - dựng
`createFakeD1()` fake `D1Database` bọc một sqlite handle thật (D1 tương thích
SQL với sqlite, cùng DDL từ `migration.ts`), đủ trung thực để test where/
publishedOnly/findEntry qua adapter D1 thật, không cần binding Cloudflare
sống. 60 file test / 630 test pass toàn repo sau khi xong.

## Giai đoạn 2 - Codegen `.d.ts` - XONG (trừ 1 hook)

- `field-registry.ts`: thêm `FIELD_TYPE_TS_TYPE` (bảng scalar type → chuỗi TS,
  chỉ 7 type đơn giản; `relation`/`component`/`relationmirror`/`select`/`image`
  xử lý riêng trong codegen vì cần `allTypes`/config).
- `src/content-types/codegen.ts` - `generateDryTypes(allTypes)`: **thuần, không
  fs, không import engine** - chỉ cần `ContentTypeDefinition[]`, dễ test
  (`codegen.test.ts`, 11 case) mà không cần DB.
- `src/content-types/dry-reader.ts` - thay vì generated file tự định nghĩa
  `DryCollectionReader`/`DryReader` inline (như bảng gốc phác), interface
  chung này viết tay MỘT LẦN, generic theo `<CMap, SMap>`; file sinh ra chỉ
  import nó rồi áp map cụ thể của project vào - gọn hơn, ít trùng lặp hơn kế
  hoạch gốc.
- File thật đã sinh: `src/apps/dry.generated.d.ts` (chạy `bun run dry:generate`
  lần đầu against DB dev thật - 6 content type, bao gồm `relationmirror` thật
  role↔user, component Menu/Seo, select có options thật). **Đã commit vào
  git** như dự kiến; `bun run typecheck` xanh xác nhận file hợp lệ.

**Lệch so với kế hoạch - hook "Apply and build"**: kế hoạch gốc định hook vào
nhánh `mode: "apply"` của `handleBatch` (`routes/content-types.ts`). Sau khi
đọc lại `handler.ts`/`adapters/node.ts`/`adapters/types.ts`: routes ở đây được
viết để chạy được trên cả Node **và Workers tương lai** (`env` luôn `{}` trên
Node vì "D1 content engine là thứ DUY NHẤT đọc context.env" - comment sẵn có
trong `content-adapters.ts`). Ghi file `.d.ts` xuống đĩa từ trong handler này
sẽ phá tính portable đó (Workers không có filesystem) và phải xuyên một side
channel mới qua `env` mà comment hiện tại đang khẳng định không tồn tại. Quyết
định: **không hook vào apply**, giữ 2 điểm hook còn lại:
1. Lúc dev-server khởi động (`scripts/dev-server.mjs`) - đã wire, có log
   `[drycms] generated dry.generated.d.ts (N content types)`, test thật bằng
   cách start dev server và xác nhận file được ghi lại.
2. `bun run dry:generate` (`scripts/dry-generate.ts`, chạy trực tiếp qua `bun`,
   không cần Vite) - để regenerate giữa session mà không phải restart dev
   server. Nếu `content.engine === "D1"` thì in thông báo rồi thoát êm (không
   có binding D1 cục bộ để một script standalone đọc).

Hệ quả: **type có thể stale giữa lúc sửa schema và lần restart/regenerate kế
tiếp** - chấp nhận được cho v1, ghi rõ ở đây để không ai ngạc nhiên.

## Giai đoạn 3 - Runtime `dry()` - CODE XONG, CHƯA GẮN VÀO GLOBAL THẬT

Đã có, có test (`dry-reader.test.ts`, 9 case, dùng sqlite adapter thật qua
`runWithDryContext`):
- `dry-context.ts` - `AsyncLocalStorage<{entries, allTypes}>` +
  `runWithDryContext`/`getDryContext`. Dùng `AsyncLocalStorage` (không phải
  biến module-level) đúng như quyết định - khác `Dry.params` bên
  `app-router.md` đang mắc lỗi này.
- `dry-reader.ts` - `dry()` export thường (không gán `globalThis`), gồm
  `collection(name).get()/.list()` và `singleton(name).get()`. `get(id)` tự
  check published qua `isPublished()` (mirror JS của
  `buildPublishedOnlyClause` cho riêng đường lookup-by-id, vì `getEntry` không
  có tham số `publishedOnly`).

**Chưa làm** (khác với kế hoạch gốc):
- **Vite virtual module / global injection**: kế hoạch gốc nói implementation
  inject `dry` vào global qua Vite plugin cho `src/apps/**`. Chưa viết, vì
  `src/apps/` đang trống - không có gì để inject vào/test cùng, và một plugin
  nhắm vào một glob rỗng chỉ là suy đoán. Dùng được NGAY bằng cách import trực
  tiếp: `import { dry } from "../content-types/dry-reader.js"` - đã ghi rõ
  trong header của file `.d.ts` sinh ra để không ai tưởng gọi `dry()` trần là
  chạy được.
- **Cache trong 1 lần render** (key `(typeName, op, args)` để 2 component đọc
  cùng entry chỉ 1 query): chưa làm - không có gì gọi lặp lại để cần cache lúc
  này; thêm sau khi có page thật gọi `dry()` nhiều lần.
- **Tạo adapter D1 mới mỗi request**: `DryRequestContext` nhận `entries` đã
  dựng sẵn (giống input của `runWithDryContext`) nên tương thích với việc
  caller tự tạo adapter D1 per-request kiểu `getContentAdapters` đang làm cho
  route admin - nhưng chưa có caller thật nào (route/page) gọi
  `runWithDryContext` cả, vì không có gì để gọi nó.

## Giai đoạn 4 - Nối vào App Router + build cache - CHƯA LÀM

Không đổi so với kế hoạch gốc - vẫn chặn hoàn toàn bởi App Router chưa tồn
tại. Không có `page.tsx`/`layout.tsx` nào để gọi `runWithDryContext`, nên
không có gì để test integration thật. Preview mode (đọc draft qua session
cookie) cũng chưa làm - `get()` hiện tại luôn published-only, không có cách
nào bypass.

## Thứ tự làm

1. ~~`plans/remove-file-engine.md`~~ - xong.
2. ~~Giai đoạn 1 (engine query)~~ - xong.
3. ~~Giai đoạn 2 (codegen)~~ - xong, trừ hook apply (xem trên).
4. ~~Giai đoạn 3~~ - code+test xong; phần "gọi `dry()` trần không cần import"
   để dành cho lúc làm Giai đoạn 4.
5. Giai đoạn 4 - cần App Router có bộ khung tối thiểu trước (file mới, tách
   riêng khỏi việc này).
