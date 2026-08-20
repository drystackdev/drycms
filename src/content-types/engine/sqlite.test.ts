import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../types.js";
import { SUPER_ADMIN_DESCRIPTION } from "../permissions.js";
import { createSqliteContentEngineAdapter } from "./sqlite.js";
import { createMemorySchemaDocumentStore } from "./schema-document-store.js";

/** Exercises the real adapter against a throwaway sqlite file (not a mock).
 * `locked`/`frozen`/`protectedFieldIds` (see `types.ts`) are enforced by the
 * HTTP route layer (`routes/content-types.ts`'s `DELETE` handler and
 * `handleSave`'s `assertNotFrozen`/`validateProtectedFields` calls - see
 * `routes/content-types.test.ts`), not by the adapter itself - the adapter
 * stays a thin, unopinionated schema-CRUD layer regardless of which type
 * it's asked to touch. */
function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-sqlite-test-"));
  const adapter = createSqliteContentEngineAdapter({
    engine: "sqlite",
    file: join(dir, "content.sqlite"),
  });
  return { adapter, dir };
}

/** Raw read against the same sqlite file, bypassing the schema-only adapter -
 * the only way to assert on seeded `role` ROW data (the adapter itself
 * exposes no row-CRUD, by design; see `engine/types.ts`). Goes through
 * `node:sqlite` directly (statically importable, unlike `bun:sqlite` under
 * vitest's module resolution) rather than `sqlite.ts`'s own driver-detection -
 * this only ever needs to read back what that adapter just wrote to the same
 * file, on whichever driver it actually picked. */
async function queryAll<T = unknown>(dir: string, sql: string): Promise<T[]> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "content.sqlite"));
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("createSqliteContentEngineAdapter", () => {
  it("seeds the built-in user/menu/menuItem/aiKey/role/redirect/memory/seoDefaults/systemSettings/githubSync defaults on first boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const types = await adapter.listContentTypes();
    expect(types.map((t) => t.name).sort()).toEqual([
      "aiKey",
      "githubSync",
      "memory",
      "menu",
      "menuItem",
      "redirect",
      "role",
      "seo",
      "seoDefaults",
      "systemSettings",
      "user",
    ]);
    const byName = (name: string) => types.find((t) => t.name === name)!;
    expect(byName("role").hidden).toBe(true);
    expect(byName("aiKey").hidden).toBe(true);
    expect(byName("redirect").hidden).toBe(true);
    expect(byName("memory").hidden).toBe(true);
    expect(byName("systemSettings").hidden).toBe(true);
    expect(byName("user").hidden).toBeFalsy();
  });

  it("seeds the permanent Super Admin role at boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);
    await adapter.listContentTypes(); // triggers boot

    const roles = await queryAll<{ name: string; description: string; isSuperAdmin: number }>(
      dir,
      'SELECT "name", "description", "isSuperAdmin" FROM "role";',
    );
    expect(roles).toEqual([{ name: "Super Admin", description: SUPER_ADMIN_DESCRIPTION, isSuperAdmin: 1 }]);
  });

  it("seeds a Main menu with Home and About items on first boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);
    await adapter.listContentTypes();

    const menus = await queryAll<{ id: number; name: string }>(dir, 'SELECT "id", "name" FROM "menu";');
    expect(menus).toHaveLength(1);
    expect(menus[0]!.name).toBe("Main");
    const items = await queryAll<{ label: string; href: string }>(
      dir,
      `SELECT "label", "href" FROM "menu_refs" WHERE "parent_id" = ${menus[0]!.id} ORDER BY "position";`,
    );
    expect(items).toEqual([
      { label: "Home", href: "/" },
      { label: "About", href: "/about" },
    ]);
  });

  it("the adapter itself has no locked/frozen enforcement - that's the HTTP route's job (see routes/content-types.test.ts)", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const user = (await adapter.listContentTypes()).find(
      (t) => t.name === "user",
    )!;
    await adapter.deleteContentType(user.id);

    const stillThere = await adapter.getContentType(user.id);
    expect(stillThere).toBeNull();
  });

  it("still allows deleting an ordinary content type", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const custom: ContentTypeDefinition = {
      id: "custom-note",
      kind: "collection",
      name: "note",
      label: "Note",
      fields: [],
      version: 0,
    };
    const plan = await adapter.planSave(custom);
    await adapter.applySave(custom, plan);

    await expect(
      adapter.deleteContentType("custom-note"),
    ).resolves.toBeUndefined();
    expect(await adapter.getContentType("custom-note")).toBeNull();
  });

  it("bumps the content-types collection's data version on boot seed, save, and delete", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.listContentTypes(); // triggers the boot seed
    const afterBoot = await adapter.getResourceVersion();
    expect(afterBoot).toBeGreaterThan(0);

    const custom: ContentTypeDefinition = {
      id: "custom-note",
      kind: "collection",
      name: "note",
      label: "Note",
      fields: [],
      version: 0,
    };
    const plan = await adapter.planSave(custom);
    await adapter.applySave(custom, plan);
    const afterSave = await adapter.getResourceVersion();
    expect(afterSave).toBe(afterBoot + 1);

    await adapter.deleteContentType("custom-note");
    const afterDelete = await adapter.getResourceVersion();
    expect(afterDelete).toBe(afterSave + 1);
  });
});

/**
 * The schema itself no longer lives in the database (`status/content-types-
 * json-file.md`): it is `content/types.json`, reached through a
 * `SchemaDocumentStore`. These cover the two things that can only go wrong
 * at that seam - a second adapter over the same document must see the first
 * one's writes, and a project that predates the document must have its old
 * `metadata` table imported exactly once.
 */
describe("content/types.json as the schema store", () => {
  it("persists an applied type into the document, where a second adapter over the same store finds it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drycms-sqlite-doc-test-"));
    dirs.push(dir);
    const store = createMemorySchemaDocumentStore();
    const file = join(dir, "content.sqlite");
    const first = createSqliteContentEngineAdapter({ engine: "sqlite", file }, store);

    const note: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
    await first.applySave(note, await first.planSave(note));

    const doc = await store.read();
    expect(doc?.applied.map((type) => type.name)).toContain("note");
    // Nothing is written to a `metadata` table any more - the tables in the
    // database are the CONTENT tables only.
    const tables = await queryAll<{ name: string }>(dir, `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table';`);
    expect(tables.map((row) => row.name)).not.toContain("metadata");

    const second = createSqliteContentEngineAdapter({ engine: "sqlite", file }, store);
    expect((await second.listContentTypes()).map((type) => type.name)).toContain("note");
  });

  it("imports a pre-document project's `metadata` rows once, without re-seeding its tables", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drycms-sqlite-legacy-test-"));
    dirs.push(dir);
    const file = join(dir, "content.sqlite");

    // A project as it looked before the move: definitions in `metadata`, the
    // matching table already created.
    const legacy: ContentTypeDefinition = { id: "legacy-post", kind: "collection", name: "post", label: "Post", fields: [], version: 3 };
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE "metadata" ("id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "name" TEXT NOT NULL, "definition" TEXT NOT NULL, "version" INTEGER NOT NULL);`);
    db.exec(`CREATE TABLE "post" ("id" INTEGER PRIMARY KEY AUTOINCREMENT);`);
    db.prepare(`INSERT INTO "metadata" ("id","kind","name","definition","version") VALUES (?,?,?,?,?);`)
      .run(legacy.id, legacy.kind, legacy.name, JSON.stringify(legacy), legacy.version);
    db.close();

    const store = createMemorySchemaDocumentStore();
    const adapter = createSqliteContentEngineAdapter({ engine: "sqlite", file }, store);
    const types = await adapter.listContentTypes();

    // The imported type survives at its own version, and the built-in
    // defaults are seeded alongside it.
    expect(types.find((type) => type.id === "legacy-post")?.version).toBe(3);
    expect(types.map((type) => type.name)).toContain("user");
    expect((await store.read())?.applied.map((type) => type.id)).toContain("legacy-post");
  });
});
