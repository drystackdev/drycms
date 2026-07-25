import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createDB } from "./db.js";

// vitest's worker pool runs under plain Node (not Bun) even when launched via
// `bun run test`, so use `node:sqlite` here rather than `bun:sqlite`.
const req = createRequire(import.meta.url);
const { DatabaseSync: Database } = req("node:sqlite") as { DatabaseSync: new (path: string) => any };

function freshDb() {
  const raw = new Database(":memory:");
  const db = createDB(raw);
  return { raw, db };
}

// Minimal D1Database-shaped wrapper over node:sqlite, just to exercise the
// `.batch`-detection / async branch of the driver adapter in tests (no real
// Cloudflare Workers runtime available here).
function fakeD1(raw: any) {
  const stmt = (sql: string) => {
    let bound: unknown[] = [];
    const api = {
      bind(...values: unknown[]) {
        bound = values;
        return api;
      },
      async first<T>() {
        return (raw.prepare(sql).get(...bound) as T | undefined) ?? null;
      },
      async run() {
        const res = raw.prepare(sql).run(...bound);
        return { meta: { last_row_id: Number(res.lastInsertRowid) } };
      },
      async all<T>() {
        return { results: raw.prepare(sql).all(...bound) as T[] };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async batch(statements: unknown[]) {
      return Promise.all(statements as Promise<unknown>[]);
    },
  };
}

async function migrateInTempDir(db: ReturnType<typeof createDB>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drycms-db-test-"));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await db.migrate();
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("createDB", () => {
  it("validates required/unique/format on creates() and hashes PASSWORD", async () => {
    const { raw, db } = freshDb();
    const user = db.table("user", {
      name: db.TEXT({ min: 1, max: 50 }).REQUIRED(),
      email: db.TEXT({ format: "email" }).INDEX().UNIQUE(),
      password: db.PASSWORD(),
    });
    const { statements } = await migrateInTempDir(db);
    for (const stmt of statements) raw.exec(stmt);

    const query = db.query();

    // @ts-expect-error thiếu field "name" bắt buộc -> phải bị TypeScript chặn
    const missingName = await query(user).creates({ email: "a@b.com" });
    expect(missingName.error?.name).toBeTruthy();

    const badEmail = await query(user).creates({ name: "A", email: "not-an-email" });
    expect(badEmail.error?.email).toBeTruthy();

    const created = await query(user).creates({
      name: "Khan",
      email: "khan@gmail.com",
      password: "secret123",
    });
    expect(created.error).toBeUndefined();
    const row = created.success;
    expect(row?.id).toBeTypeOf("number");
    expect((row as { password?: unknown } | undefined)?.password).toBeUndefined();

    const dup = await query(user).creates({ name: "Khan2", email: "khan@gmail.com" });
    expect(dup.error?.email).toBeTruthy();

    expect(await db.verifyPassword("user", row!.id, "secret123")).toBe(true);
    expect(await db.verifyPassword("user", row!.id, "wrong")).toBe(false);
  });

  it("supports where operators, sort tie-breaker, and pagination", async () => {
    const { raw, db } = freshDb();
    const user = db.table("user", { name: db.TEXT().REQUIRED(), email: db.TEXT() });
    const { statements } = await migrateInTempDir(db);
    for (const stmt of statements) raw.exec(stmt);

    const query = db.query();
    await query(user).creates([
      { name: "A", email: "a@gmail.com" },
      { name: "B", email: "b@yahoo.com" },
      { name: "C", email: "c@gmail.com" },
    ]);

    const gmailUsers = await query(user).where({ email: { endsWith: "gmail.com" } }).get();
    expect(gmailUsers.map((u) => u.name).sort()).toEqual(["A", "C"]);

    const page = await query(user).sort({ name: "asc" }).pagination(2, 0).get();
    expect(page).toHaveLength(2);
    expect(page[0]?.name).toBe("A");

    const uppercased = await query(user)
      .where({ name: "A" })
      .select({ name: (v) => String(v).toLowerCase() })
      .get();
    expect(uppercased[0]?.name).toBe("a");
  });

  it("REF: filters via EXISTS in where and includes nested object in select", async () => {
    const { raw, db } = freshDb();
    const role = db.table("role", { name: db.TEXT().REQUIRED() });
    const user = db.table("user", { name: db.TEXT().REQUIRED() }).add({ role: db.REF(role) });

    const { statements } = await migrateInTempDir(db);
    for (const stmt of statements) raw.exec(stmt);

    const query = db.query();
    const adminRole = (await query(role).creates({ name: "Admin" })).success;
    await query(user).creates({ name: "Khan", role: adminRole!.id });
    await query(user).creates({ name: "Guest" });

    // `q` bên trong callback được suy type theo đúng cột của bảng `role`.
    const filtered = await query(user)
      .where({ role: (q) => q.where({ name: "Admin" }) })
      .get();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("Khan");

    const withInclude = await query(user)
      .where({ name: "Khan" })
      .select({ name: true, role: { name: true } })
      .get();
    expect(withInclude[0]?.role).toEqual({ name: "Admin" });
  });

  it("REFS: join-table filter (some) and array include", async () => {
    const { raw, db } = freshDb();
    const permission = db.table("permission", { name: db.TEXT().REQUIRED() });
    const user = db.table("user", { name: db.TEXT().REQUIRED() }).add({ permissions: db.REFS(permission) });

    const { statements } = await migrateInTempDir(db);
    for (const stmt of statements) raw.exec(stmt);

    const query = db.query();
    const read = (await query(permission).creates({ name: "read" })).success;
    const write = (await query(permission).creates({ name: "write" })).success;
    const khan = (await query(user).creates({ name: "Khan" })).success;
    await query(user).creates({ name: "Guest" });

    raw.exec(
      `INSERT INTO user_permission (user_id, permission_id) VALUES (${khan!.id}, ${read!.id}), (${khan!.id}, ${write!.id})`,
    );

    const withPerms = await query(user)
      .where({ name: "Khan" })
      .select({ name: true, permissions: { name: true } })
      .get();
    expect(withPerms[0]?.permissions).toHaveLength(2);

    const filtered = await query(user)
      .where({ permissions: (q) => q.where({ name: "write" }) })
      .get();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("Khan");
  });

  it("migrate() writes an incremental ALTER TABLE when a column is added", async () => {
    const { raw, db } = freshDb();
    const user = db.table("user", { name: db.TEXT().REQUIRED() });
    const first = await migrateInTempDir(db);
    expect(first.statements.some((s) => s.includes("CREATE TABLE user"))).toBe(true);
    for (const stmt of first.statements) raw.exec(stmt);

    user.add({ nickname: db.TEXT() });
    const second = await migrateInTempDir(db);
    expect(second.statements.some((s) => s.includes("ADD COLUMN nickname"))).toBe(true);
  });

  it("update() and delete() apply to rows matched by where()", async () => {
    const { raw, db } = freshDb();
    const user = db.table("user", { name: db.TEXT().REQUIRED() });
    const { statements } = await migrateInTempDir(db);
    for (const stmt of statements) raw.exec(stmt);

    const query = db.query();
    const created = (await query(user).creates({ name: "Khan" })).success;

    const updated = await query(user).where("id", created!.id).update({ name: "Khan Tran" });
    expect(updated[0]?.name).toBe("Khan Tran");

    const deleted = await query(user).where("id", created!.id).delete();
    expect(deleted).toHaveLength(1);

    const remaining = await query(user).where({ id: created!.id }).get();
    expect(remaining).toHaveLength(0);
  });

  it("works against a D1-shaped async driver (.batch present)", async () => {
    const raw = new Database(":memory:");
    const db = createDB(fakeD1(raw));
    const user = db.table("user", { name: db.TEXT().REQUIRED() });

    const { statements } = await migrateInTempDir(db);
    for (const stmt of statements) raw.exec(stmt);

    const query = db.query();
    const created = (await query(user).creates({ name: "Khan" })).success;
    expect(created?.id).toBeTypeOf("number");

    const found = await query(user).where({ name: "Khan" }).get();
    expect(found).toHaveLength(1);
  });
});
