import { Database } from "bun:sqlite";
import { createDB } from "drycms/db";

// Giữ raw driver để tự áp SQL migration cục bộ (createDB() ở chế độ auto-detect
// không trả instance ra ngoài, nên ở đây tự tạo bun:sqlite rồi truyền vào).
const raw = new Database("db.sqlite");
const db = createDB(raw);

const user = db.table("user", {
  name: db.TEXT({ min: 1, max: 50 }).REQUIRED(),
  email: db.TEXT({ format: "email" }).INDEX().UNIQUE(),
  password: db.PASSWORD(),
});

const { file, statements } = await db.migrate();

if (statements.length > 0) {
  for (const stmt of statements) raw.exec(stmt);
  console.log(`Đã áp dụng migration: ${file}`);
  console.log(statements.join("\n\n"));
} else {
  console.log("Không có thay đổi schema, bỏ qua migration.");
}

// Không còn db.query() - gọi thẳng where/select/creates/... trên chính
// `user` (handle từ db.table()). Thiếu `name` sẽ bị TypeScript báo lỗi ngay
// lúc code, không cần đợi chạy mới biết.
const invalid = await user.creates({ name: "A", email: "not-an-email" });
console.log("\nEmail sai định dạng (name đã có, bắt ở runtime qua jsonSchema) ->", invalid);

const created = await user.creates({
  name: "Khan Tran",
  email: "khan@gmail.com",
  password: "secret123",
});
console.log("\nTạo user hợp lệ ->", created);

const users = await user.get();
console.log("\nDanh sách user (password bị ẩn mặc định) ->", users);

// verifyPassword nằm thẳng trên row trả về (không cần truyền lại table/id).
const row = created.success;
if (row) {
  console.log("\nverifyPassword('secret123') ->", await row.verifyPassword("secret123"));
  console.log("verifyPassword('sai') ->", await row.verifyPassword("sai"));
}
