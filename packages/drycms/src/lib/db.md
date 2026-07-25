# db.ts — thư viện SQLite/D1 tối giản

Thư viện 1 file (`db.ts`) cung cấp: column builder tự sinh JSON Schema + TS
type, table handle vừa định nghĩa schema vừa truy vấn trực tiếp (kiểu
ActiveRecord, rút gọn cho SQLite), và migration diff sinh file `.sql`. Chạy
được trên Cloudflare D1, `better-sqlite3`, `bun:sqlite`, `node:sqlite`.

> Thiết kế nền tảng: xem `status/db.md` để biết đầy đủ các quyết định (vì sao
> validate không nằm ở SQL schema, vì sao migration chỉ sinh file không
> auto-apply, vì sao không có `db.query()`, v.v).

## Cài đặt / import

```ts
import { createDB } from "drycms/db";
```

## 1. Khởi tạo

```ts
const db = createDB(instance?);
```

`instance` là 1 trong 4 loại, **đã tạo sẵn** (không nhận string/path):

| Instance | Môi trường |
|---|---|
| `D1Database` (`env.DB`) | Cloudflare Workers/Pages, production |
| `better-sqlite3` instance | Node, cần tự cài `better-sqlite3` |
| `bun:sqlite` `Database` | Bun runtime |
| `node:sqlite` `DatabaseSync` | Node ≥ 22.5 |

```ts
// Cloudflare Worker
const db = createDB(env.DB);

// Local, tự quản driver để còn dùng raw.exec() áp migration
import { Database } from "bun:sqlite";
const raw = new Database("db.sqlite");
const db = createDB(raw);
```

Không truyền gì → tự phát hiện runtime (Bun hay Node) và tự mở file
`db.sqlite` ở thư mục hiện tại. Không rơi vào 1 trong 2 (runtime khác, hoặc
`node:sqlite` không khả dụng) → throw lỗi liệt kê rõ 4 lựa chọn hợp lệ. Nhược
điểm: bạn không giữ được `raw` để tự `exec()` migration cục bộ — nên khi cần
chạy local, nên tự tạo driver như ví dụ trên thay vì gọi `createDB()` trần.

## 2. Định nghĩa bảng

Mỗi bảng luôn có sẵn `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `created_at`,
`updated_at` (TEXT, tự set khi tạo/sửa) — không cần khai báo.

```ts
const user = db.table("user", {
  name: db.TEXT({ min: 1, max: 50 }).REQUIRED(),
  email: db.TEXT({ format: "email" }).INDEX().UNIQUE(),
  password: db.PASSWORD(),
});
```

`user` — giá trị trả về từ `db.table()` — là **đối tượng duy nhất bạn cần**:
nó vừa mang schema, vừa là nơi gọi mọi thao tác truy vấn (xem mục 5). Không có
`db.query()` nào khác để nhớ.

### Kiểu cột

| Factory | Kiểu SQL | Kiểu TS |
|---|---|---|
| `db.TEXT({ min?, max?, format?: 'email'\|'url'\|'uuid', regex? })` | TEXT | `string` |
| `db.INT({ min?, max? })` | INTEGER | `number` |
| `db.NUMBER({ min?, max? })` | REAL | `number` |
| `db.BOOL()` | INTEGER | `boolean` |
| `db.DATE()` | TEXT (ISO) | `string` |
| `db.JSON<T>()` | TEXT | `T` |
| `db.PASSWORD()` | TEXT (hash) | `string` |
| `db.REF(targetTable)` | INTEGER | `number` + quan hệ |
| `db.REFS(targetTable)` | *(bảng phụ riêng)* | quan hệ nhiều |

### Modifier (chainable)

- `.REQUIRED()` — bắt buộc phải có khi `.creates()` (vào JSON Schema
  `required`, **không** phải SQL `NOT NULL`).
- `.UNIQUE()` — kiểm tra trùng ở code trước khi ghi (không phải SQL `UNIQUE`
  constraint), tự kèm `.INDEX()`.
- `.INDEX()` — sinh `CREATE INDEX` thật khi migrate.
- `.DEFAULT(value)` — giá trị mặc định khi field bị bỏ trống lúc tạo.

> Toàn bộ validate (required/unique/format/min/max/regex) chỉ chạy ở tầng
> code qua JSON Schema tự sinh — SQL schema chỉ có kiểu thô (TEXT/INTEGER/REAL).
> Đây là quyết định thiết kế có chủ đích, không phải thiếu sót.

## 3. Thêm/xoá cột, quan hệ

```ts
const role = db.table("role", { name: db.TEXT().REQUIRED() });

user = user.addColumn({
  address: db.TEXT({ regex: "^\\d*$" }),
  role: db.REF(role), // cột INTEGER tên "role", trỏ tới bảng role
  permissions: db.REFS(permissionTable), // bảng phụ user_permission (n-n)
});

user = user.removeColumn("address");
```

**Bắt buộc gán lại `user = user.addColumn(...)` / `user = user.removeColumn(...)`**
để lấy được type mới (TypeScript không tự "vá" type của biến `user` cũ sau khi
đổi schema — đây là giới hạn cứng của type system, không phải sơ suất; xem
`status/db.md`). Ở runtime, gán lại hay không đều được (cùng 1 instance, tự
mutate), nhưng không gán lại thì type sẽ thiếu cột mới.

- `db.REF(target)`: thêm 1 cột INTEGER **đúng tên field** đã khai báo (không tự
  thêm hậu tố `_id`) — không có `FOREIGN KEY` thật ở SQL.
- `db.REFS(target)`: **không** thêm cột nào vào bảng hiện tại — tạo 1 bảng phụ
  `<bảngA>_<bảngB>` (2 cột `<bảngA>_id`, `<bảngB>_id`) khi migrate. Ghi vào
  bảng phụ này hiện phải tự viết SQL tay (`INSERT INTO user_permission ...`),
  chưa có helper riêng.

## 4. Sinh & áp dụng migration

```ts
const { file, statements } = await db.migrate();
```

So sánh schema khai báo trong code với DB thật (`PRAGMA table_info`), rồi ghi
1 file `.sql` vào `migrations/` (convention giống `wrangler d1 migrations`).
**Không tự áp dụng** vào DB — bạn tự chạy:

- Production (D1): `wrangler d1 migrations apply`.
- Local (driver bạn tự tạo, còn giữ `raw`):
  ```ts
  for (const stmt of statements) raw.exec(stmt);
  ```

## 5. Truy vấn — gọi thẳng trên table handle

Không có `db.query()`. Mọi thao tác gọi trực tiếp trên biến bảng (`user`).

### Tạo mới

```ts
const created = await user.creates({
  name: "Khan Tran",
  email: "khan@gmail.com",
  password: "secret123",
});
// { success: { id, created_at, updated_at, name, email } }  (password bị ẩn)

// Lỗi validate:
// { error: { name: ["name là bắt buộc"], email: ["email không phải email hợp lệ"] } }
```

Nhận 1 object **hoặc** mảng object; `success` khớp hình dạng input (1 object
vào → object ra, mảng vào → mảng ra — không phải đoán/ép kiểu).

### Sửa / xoá

```ts
await user.where("id", 1).update({ name: "Khan" }); // -> hàng khớp[]
await user.where("id", 1).delete(); // -> hàng đã xoá[]

// Không gọi .where() trước -> áp dụng cho TOÀN BỘ row (đúng ngữ nghĩa SQL
// UPDATE/DELETE không WHERE) - cẩn thận khi dùng.
await user.update({ role: null });
```

### Lọc, chọn field, sắp xếp, phân trang

```ts
const result = await user
  .where({
    OR: [{ name: "A" }, { name: "B" }],
    email: { endsWith: "gmail.com" },
  })
  .select({
    name: (v) => v.toUpperCase(), // hàm biến đổi giá trị (chạy ở JS)
    email: true, // true = lấy nguyên giá trị
  })
  .sort({ name: "asc" }) // luôn kèm updated_at desc làm tie-breaker
  .pagination(20, 0) // take, skip
  .get();

// Không lọc gì, lấy hết:
const all = await user.get();
```

Operator hỗ trợ trong `where`: `equals` (mặc định khi gán giá trị trực tiếp),
`not`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`, `in`,
`notIn`.

### Quan hệ trong `where` (lọc) và `select` (include)

```ts
// where: callback = lọc kiểu EXISTS, KHÔNG trả dữ liệu quan hệ ra ngoài
const admins = await user.where({ role: (q) => q.where({ name: "Admin" }) }).get();

// REFS (n-n): where nghĩa là "tồn tại ít nhất 1 bản ghi liên kết khớp"
const withWritePerm = await user
  .where({ permissions: (q) => q.where({ name: "write" }) })
  .get();

// select: true = lấy TOÀN BỘ cột bảng đích; object lồng = chỉ lấy field chỉ định
const withRole = await user
  .select({ name: true, role: true }) // role: { id, created_at, updated_at, name } | null
  .get();

const withRoleName = await user
  .select({ name: true, role: { name: true } }) // role: { name } | null
  .get();

const withPerms = await user
  .select({ name: true, permissions: { name: true } }) // permissions: {name}[]
  .get();
```

`q` bên trong callback được gõ đúng theo cột của **bảng đích** (`role`/
`permission`), có autocomplete. Lưu ý: include ở `select()` hiện lấy **toàn
bộ** bản ghi liên kết, không tự lọc theo điều kiện đã dùng ở `where()` của
bảng cha.

## 6. Mật khẩu

`db.PASSWORD()` tự hash bằng PBKDF2 (`crypto.subtle`, không cần dependency
ngoài) khi `.creates()`/`.update()`. Mặc định **luôn bị ẩn** khỏi kết quả
`.get()`/`.select()`.

`verifyPassword` nằm thẳng trên **row trả về** (không phải trên `user`/table
handle) — chỉ những bảng có cột `PASSWORD()` mới có method này, TypeScript tự
biết và autocomplete đúng:

```ts
const created = await user.creates({ name: "Khan", password: "secret123" });
await created.success?.verifyPassword("secret123"); // -> true

const [found] = await user.where({ name: "Khan" }).get();
await found?.verifyPassword("secret123"); // -> true
```

`verifyPassword` không hiện trong `Object.keys()`/`JSON.stringify()`/spread
(gắn bằng property non-enumerable) nên không lẫn vào response API trả ra
ngoài, dù vẫn gọi trực tiếp được trên object.

## 7. Type-safety

```ts
const user = db.table("user", { name: db.TEXT().REQUIRED(), ... });

user.where({ name: "Khan" })   // ✅ autocomplete field, thiếu field REQUIRED()
                               //    ở .creates() bị TypeScript chặn ngay lúc code
```

Vì `user` mang theo đúng generic của schema đã khai báo, mọi method
(`where/select/sort/pagination/get/update/delete/creates`) đều được suy type
chính xác — không cần `as any`, không có bước trung gian nào để mất type.

## 8. Giới hạn hiện tại

- Include quan hệ ở `select()` không tự lọc bản ghi con, chưa có cú pháp lọc
  kèm include trong cùng 1 lời gọi.
- Chưa có helper ghi/xoá row trong bảng phụ `REFS` — phải tự viết SQL
  (`INSERT/DELETE FROM <bảngA>_<bảngB> ...`).
- `createDB()` không tham số (auto-detect) không trả `raw` driver ra ngoài,
  nên không tự `exec()` migration cục bộ được — nên tự tạo driver (xem mục 1)
  khi cần chạy thử local.
- `db.migrate()` chỉ diff cột thêm/xoá + index; chưa diff đổi kiểu cột hay đổi
  tên cột (rename = xoá + thêm mới, mất dữ liệu cột đó).
- `user.update(...)`/`user.delete()` gọi trực tiếp (không qua `.where()`) sẽ
  áp dụng cho **toàn bộ** row trong bảng — đúng ngữ nghĩa SQL, nhưng dễ nhầm
  nếu quên `.where()`.

## Ví dụ đầy đủ

Xem [`db.ts`](../../../../db.ts) ở root repo — script chạy được trực tiếp
bằng `bun run db.ts`, tạo bảng `user`, migrate, tạo user, validate lỗi, và
verify password.
