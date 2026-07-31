import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../types.js";
import { SUPER_ADMIN_DESCRIPTION } from "../permissions.js";
import { createSqliteContentEngineAdapter } from "./sqlite.js";

/** Exercises the real adapter against a throwaway sqlite file (not a mock) -
 * the only way to actually prove deletion of a built-in content type is
 * refused server-side, not just hidden by the editor UI. */
function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-sqlite-test-"));
  const adapter = createSqliteContentEngineAdapter({
    engine: "sqlite",
    file: join(dir, "content.sqlite"),
  });
  return { adapter, dir };
}

/** Raw read against the same sqlite file, bypassing the schema-only adapter -
 * the only way to assert on `role`/`permission` ROW data (the adapter itself
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
  it("seeds the built-in user/menu/menuItem/aiKey/role/permission defaults on first boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const types = await adapter.listContentTypes();
    expect(types.map((t) => t.name).sort()).toEqual([
      "aiKey",
      "menu",
      "menuItem",
      "permission",
      "role",
      "seo",
      "user",
    ]);
    expect(types.every((t) => !t.system)).toBe(true);
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

  it("creates 4 permission rows (view/create/update/delete) for every built-in collection/singleton at boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);
    await adapter.listContentTypes(); // triggers boot

    const permissions = await queryAll<{ name: string; action: string }>(
      dir,
      'SELECT "name", "action" FROM "permission" ORDER BY "name", "action";',
    );
    expect(permissions).toEqual([
      { name: "aiKey", action: "create" },
      { name: "aiKey", action: "delete" },
      { name: "aiKey", action: "update" },
      { name: "aiKey", action: "view" },
      { name: "menu", action: "create" },
      { name: "menu", action: "delete" },
      { name: "menu", action: "update" },
      { name: "menu", action: "view" },
      { name: "permission", action: "create" },
      { name: "permission", action: "delete" },
      { name: "permission", action: "update" },
      { name: "permission", action: "view" },
      { name: "role", action: "create" },
      { name: "role", action: "delete" },
      { name: "role", action: "update" },
      { name: "role", action: "view" },
      { name: "user", action: "create" },
      { name: "user", action: "delete" },
      { name: "user", action: "update" },
      { name: "user", action: "view" },
    ]);
  });

  it("allows deleting a built-in content type, same as any other (system is purely a UI label)", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const user = (await adapter.listContentTypes()).find(
      (t) => t.name === "user",
    )!;
    await adapter.deleteContentType(user.id);

    const stillThere = await adapter.getContentType(user.id);
    expect(stillThere).toBeNull();
  });

  it("still allows deleting an ordinary, non-system content type", async () => {
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

  it("creates 4 matching permission rows (view/create/update/delete) when a new collection is saved", async () => {
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

    const rows = await queryAll<{ name: string; idTable: string; action: string }>(
      dir,
      `SELECT "name", "idTable", "action" FROM "permission" WHERE "idTable" = 'custom-note' ORDER BY "action";`,
    );
    expect(rows).toEqual([
      { name: "note", idTable: "custom-note", action: "create" },
      { name: "note", idTable: "custom-note", action: "delete" },
      { name: "note", idTable: "custom-note", action: "update" },
      { name: "note", idTable: "custom-note", action: "view" },
    ]);
  });

  it("updates every action's permission row name when the collection is renamed", async () => {
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
    const saved = await adapter.applySave(custom, plan);

    const renamed = { ...saved, name: "memo", label: "Memo" };
    const renamePlan = await adapter.planSave(renamed);
    await adapter.applySave(renamed, renamePlan);

    const rows = await queryAll<{ name: string }>(
      dir,
      `SELECT "name" FROM "permission" WHERE "idTable" = 'custom-note' ORDER BY "action";`,
    );
    expect(rows).toEqual([
      { name: "memo" },
      { name: "memo" },
      { name: "memo" },
      { name: "memo" },
    ]);
  });

  it("removes every action's permission row when the collection is deleted", async () => {
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
    await adapter.deleteContentType("custom-note");

    const rows = await queryAll(
      dir,
      `SELECT * FROM "permission" WHERE "idTable" = 'custom-note';`,
    );
    expect(rows).toEqual([]);
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
