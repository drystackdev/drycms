# Xây dựng hệ thống reader từ content type metadata

Reader = lớp đọc content cho `src/apps` (App Router - xem `plans/app-router.md`),
sinh type tự động từ `ContentTypeDefinition[]` nên page code có autocomplete +
type-check thật, không phải `any`.

## Ý tưởng gốc

```tsx
const { email } = dry().collection("user", /* id or slug */)
const {} = dry().singleton("", ...)
```

- Khi save content meta sẽ sinh ra file type để làm việc này.
- Sinh `.d.ts` (hoặc JSON Schema) từ metadata; `dry` là hàm có sẵn trong global.

## Quyết định đã chốt

1. **API async** (phương án A). `page.tsx` là `async function`, render bằng
   `renderToStringAsync`. Không làm two-pass "collect → render sync" ở v1 -
   để dành, vì nó chỉ đáng khi cần dependency-graph tự động cho build cache.
   → `plans/app-router.md` dòng 10 ("các file chạy ở server nên là sync
   functions") phải sửa lại cho khớp.
2. **Chỉ `sqlite` + `D1`.** Engine `file` bị gỡ hẳn khỏi repo trước/song song
   với việc này - xem `plans/remove-file-engine.md`. Reader không viết code
   nào cho engine `file`.
3. Backend `github`/`gitlab` không còn tồn tại (storage chỉ còn `kind: "local"`),
   nên không còn ràng buộc "1 read = 1 API call chậm 5-25s" - reader được phép
   đọc nhiều lần trong một lần render.

## Bề mặt API

Tách rõ get-one và list thay vì overload một hàm như ý tưởng gốc (một hàm trả
lúc thì object lúc thì mảng thì không type được sạch):

```ts
const post     = await dry().collection("post").get("my-slug")   // id | slug
const posts    = await dry().collection("post").list({ ... })
const settings = await dry().singleton("settings").get()
```

- `collection(name)` / `singleton(name)` nhận **tên type** (`ContentTypeDefinition.name`),
  literal union sinh sẵn trong `.d.ts` → gõ sai tên là lỗi compile.
- `get()` trả `Post | null`; `list()` trả `{ rows: Post[]; total: number }`.
- Options của `list()`: `where`, `sort`, `limit`/`page`, `populate` (bung
  relation), `includeDraft` (mặc định `false`).
- **Mặc định chỉ trả entry đã publish**: bỏ row có `draft === true`, bỏ row có
  `schedule` ở tương lai (hai system field này chỉ tồn tại khi
  `features.draft`/`features.schedule` bật - xem `src/content-types/system-fields.ts`).
  Đây là mặc định an toàn: quên set thì site public không lộ bản nháp.
- `dry()` **bỏ qua permission** (chạy ở build/SSR, tin cậy) - phải ghi rõ trong
  docs, đừng để ai tưởng nó lọc theo user.
- Field `password`/`secretkey` vẫn được mask sẵn bởi `rowToValue`
  (`engine/entry-codec.ts`) - reader không cần làm gì thêm, nhưng type sinh ra
  nên đánh dấu chúng là `never`/loại khỏi interface để không ai đọc nhầm.

## Giai đoạn 1 - Bổ sung query cho engine (sqlite + D1)

Đây là khối lượng code lớn nhất, không phải cái wrapper `dry()`.
`ContentEntryEngineAdapter` (`src/content-types/engine/entries-types.ts:56-101`)
hiện chỉ có `getEntry(id)` và `listEntries({page,pageSize,sort,search})` -
`search` là `LIKE` trên các cột đã toggle, không phải filter.

Thiếu:

- **Lookup theo slug.** `features.slug` tạo cột `slug` `unique`
  (`system-fields.ts:100-107`), nhưng không có đường tra theo nó.
- **`where` thật.** Cần ít nhất `eq`/`in`/`ne`/`gt`/`lt` trên các cột
  `flattenQueryableColumns` (`engine/entry-tree.ts`).
- **Lọc published.** Là một `where` đặc biệt (`draft`/`schedule`), nhưng phải
  chạy trong SQL chứ không lọc sau khi paginate, nếu không `total` sai.

Việc cần làm:

1. Thêm vào `ContentEntryEngineAdapter`:
   - `findEntry(type, allTypes, where): Promise<EntryRow | null>`
   - mở rộng `EntryQuery` bằng `where?: EntryWhere` và `publishedOnly?: boolean`
   - `EntryWhere` là cây điều kiện đã kiểu hoá, **không nhận SQL thô**; adapter
     tự resolve field name → column name qua `entry-tree.ts` (cùng nguyên tắc
     `EntryQuery.sortField` đang dùng - xem comment ở `entries-types.ts:24-27`).
2. Cài ở `entries-sqlite.ts` (chỗ dựng `whereSql` hiện tại là dòng ~294-316)
   và `entries-d1.ts`. Hai file này song song nhau nên phần build SQL nên tách
   ra một helper dùng chung, tránh lệch hành vi.
3. Unit test cho cả hai: slug hit/miss, where trên từng field shape, published
   filter có ảnh hưởng đúng lên `total`, và where trên field không queryable
   phải ném lỗi rõ ràng chứ không im lặng bỏ qua.

## Giai đoạn 2 - Codegen `.d.ts`

Nguồn: `adapter.listContentTypes()` → `ContentTypeDefinition[]`
(`src/content-types/types.ts`). Sinh ra một file duy nhất, ví dụ
`src/apps/dry.generated.d.ts`, **commit vào git** để `bun run typecheck` ở CI
không cần database.

Map `field.type` → TS type: `field-registry.ts` đã mô tả sẵn qua
`FieldTypeDefinition<V>`, nhưng generic `V` chỉ tồn tại lúc compile → cần thêm
một bảng runtime `type → chuỗi TS` ngay trong `field-registry.ts` (đặt cạnh
định nghĩa để không lệch khi thêm field type mới).

Các case phải xử lý:

| Nguồn | Kết quả |
| --- | --- |
| `validation.required !== true` | `field?:` |
| `image`/`select` có `multiple` | `string[]` thay vì `string` |
| `relation` | theo `cardinality`: `manyToOne` → `Post`, `oneToMany`/`manyToMany` → `Post[]` |
| `relationmirror` | như relation, nhưng đọc-only |
| `component` | interface lồng; `repeatable` → mảng |
| `select` có `options` | union literal các option |
| `password`/`secretkey` | loại khỏi interface (luôn bị mask) |
| `features.slug/draft/schedule/timestamps/seo/sortable` | thêm system field tương ứng, dùng chính `system-fields.ts` làm nguồn |
| `kind: "component"` | chỉ sinh interface, không sinh vào union `collection`/`singleton` |

Ngoài interface từng type, file sinh ra còn cần:

- `type DryCollectionName = "post" | "user" | ...`
- `type DrySingletonName = "settings" | ...`
- map name → interface để `dry().collection("post")` suy ra được `Post`
- `declare global { function dry(): DryReader }`

Hook sinh file:

- Nhánh `mode: "apply"` của `handleBatch` trong
  `src/server/routes/content-types.ts:186` - đúng chỗ "Apply and build"
  (xem `status/content-type-staged-apply.md`).
- Một lần lúc dev-server khởi động (`scripts/dev-server.mjs`), để clone repo về
  là có type đúng ngay cả khi chưa apply gì.
- Ghi file phải atomic (ghi tạm rồi rename) và **no-op khi nội dung không đổi**,
  tránh trigger HMR vô ích mỗi lần save schema.

## Giai đoạn 3 - Runtime `dry()`

- **Không gán lên `globalThis`.** Chỉ `declare global` trong `.d.ts` (để DX có
  autocomplete, không cần import), còn implementation inject qua Vite virtual
  module + `esbuild.inject` cho `src/apps/**`.
- `dry()` phải bind vào **request hiện tại** bằng `AsyncLocalStorage`. Một biến
  module-level mutable sẽ nhiễu giữa hai request song song - `Dry.params` bên
  `app-router.md` dính đúng lỗi này, nên hai cái nên dùng chung một
  request-context store.
- Trong một lần render, cache theo key `(typeName, op, args)` để hai component
  cùng đọc một entry chỉ tốn một query.
- Với `engine: "D1"`, adapter **phải** được tạo mới mỗi request (binding chỉ tồn
  tại per-request - xem `engine/index.ts:11-18`); request context là chỗ giữ nó.

## Giai đoạn 4 - Nối vào App Router + build cache

- `page.tsx`/`layout.tsx` async, render qua `renderToStringAsync`; build ra
  `.html` + `.js` (hydrate lazy) như `app-router.md` mô tả.
- Ghi lại trong lúc render: page này đã đọc content type nào. Kết hợp với
  `getResourceVersion(type)` sẵn có (`entries-types.ts:93-100`, xem
  `status/build-cache.md`) → rebuild chọn lọc, chỉ dựng lại page nào có type
  đổi version.
- Preview mode: cho phép `dry()` đọc cả draft khi request mang cookie session
  hợp lệ (dùng lại `src/server/session.ts`), phục vụ `livePreviewUrl` của
  content type.

## Thứ tự làm

1. `plans/remove-file-engine.md` (gỡ engine `file`) - làm trước cho gọn bề mặt.
2. Giai đoạn 1 (engine query) - có unit test là xong, chưa cần UI.
3. Giai đoạn 2 (codegen) - độc lập với 1, có thể làm song song.
4. Giai đoạn 3 + 4 - cần cả 1 và 2, và cần App Router có bộ khung tối thiểu.
