# db.ts — thư viện SQLite/D1 tối giản

Thư viện 1 file (`db.ts`) cung cấp: column builder tự sinh JSON Schema + TS
type, query builder kiểu Prisma (rút gọn cho SQLite), và migration diff sinh
file `.sql`. Chạy được trên Cloudflare D1, `better-sqlite3`, `bun:sqlite`,
`node:sqlite`.

> Thiết kế nền tảng: xem `status/db.md` để biết đầy đủ các quyết định (vì sao
> validate không nằm ở SQL schema, vì sao migration chỉ sinh file không
> auto-apply, v.v).

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

**Giữ lại biến trả về** (`user` ở trên) — đây là chìa khoá để có type chính
xác + autocomplete ở bước query, xem mục [5](#5-type-safety-dùng-handle-không-dùng-string).

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

user.add({
  address: db.TEXT({ regex: "^\\d*$" }),
  role: db.REF(role), // cột INTEGER tên "role", trỏ tới bảng role
  permissions: db.REFS(permissionTable), // bảng phụ user_permission (n-n)
});

user.remove("address");
```

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

## 5. Query builder

```ts
const query = db.query();
```

### Tạo mới

```ts
const created = await query(user).creates({
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
await query(user).where("id", 1).update({ name: "Khan" }); // -> hàng khớp[]
await query(user).where("id", 1).delete(); // -> hàng đã xoá[]
```

### Lọc, chọn field, sắp xếp, phân trang

```ts
const result = await query(user)
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
```

Operator hỗ trợ trong `where`: `equals` (mặc định khi gán giá trị trực tiếp),
`not`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`, `in`,
`notIn`.

### Quan hệ trong `where` (lọc) và `select` (include)

```ts
// where: callback = lọc kiểu EXISTS, KHÔNG trả dữ liệu quan hệ ra ngoài
const admins = await query(user)
  .where({ role: (q) => q.where({ name: "Admin" }) })
  .get();

// REFS (n-n): where nghĩa là "tồn tại ít nhất 1 bản ghi liên kết khớp"
const withWritePerm = await query(user)
  .where({ permissions: (q) => q.where({ name: "write" }) })
  .get();

// select: object lồng (không phải callback) = include dữ liệu quan hệ
const withRole = await query(user)
  .select({ name: true, role: { name: true } }) // role: { name } | null
  .get();

const withPerms = await query(user)
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

```ts
await db.verifyPassword("user", userId, "mật khẩu người dùng nhập");
// -> true | false
```

## 7. Type-safety: dùng handle, không dùng string

```ts
const user = db.table("user", { name: db.TEXT().REQUIRED(), ... });
const query = db.query();

query(user)   // ✅ truyền biến handle -> type chính xác, autocomplete field,
              //    thiếu field REQUIRED() bị TypeScript chặn ngay lúc code
query("user") // ⚠️ chạy đúng ở runtime nhưng type lỏng (không autocomplete)
```

Lý do: TypeScript không thể suy type từ 1 literal string tới bảng đã đăng ký
bằng 1 lệnh `db.table(...)` riêng biệt trước đó (giới hạn của type system, xem
`status/db.md`). Luôn ưu tiên giữ lại và dùng biến `TableHandle` trả về từ
`db.table()`/`.add()` thay vì gõ lại tên bảng bằng string.

## 8. Giới hạn hiện tại

- `select({ field: true })` không hợp lệ cho cột `REF` — chỉ nhận object
  include lồng (`role: { name: true }}`), vì `REF` không có giá trị "chọn
  nguyên trạng" ở dạng số thô.
- Include quan hệ ở `select()` không tự lọc bản ghi con, chưa có cú pháp lọc
  kèm include trong cùng 1 lời gọi.
- Chưa có helper ghi/xoá row trong bảng phụ `REFS` — phải tự viết SQL
  (`INSERT/DELETE FROM <bảngA>_<bảngB> ...`).
- `createDB()` không tham số (auto-detect) không trả `raw` driver ra ngoài,
  nên không tự `exec()` migration cục bộ được — nên tự tạo driver (xem mục 1)
  khi cần chạy thử local.
- `db.migrate()` chỉ diff cột thêm/xoá + index; chưa diff đổi kiểu cột hay đổi
  tên cột (rename = xoá + thêm mới, mất dữ liệu cột đó).

## Ví dụ đầy đủ

Xem [`db.ts`](../../../../db.ts) ở root repo — script chạy được trực tiếp
bằng `bun run db.ts`, tạo bảng `user`, migrate, tạo user, validate lỗi, và
verify password.
