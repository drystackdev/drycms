import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../types.js";
import { SUPER_ADMIN_DESCRIPTION } from "../permissions.js";
import { createSqliteContentEngineAdapter } from "./sqlite.js";

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
  it("seeds the built-in user/menu/menuItem/aiKey/role/redirect/memory/seoDefaults/systemSettings/googleVerification/githubSync defaults on first boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const types = await adapter.listContentTypes();
    expect(types.map((t) => t.name).sort()).toEqual([
      "aiKey",
      "githubSync",
      "googleVerification",
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
