import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MaskedValue } from "./engine/entry-codec.js";
import { createSqliteContentEntryEngineAdapter } from "./engine/entries-sqlite.js";
import { createSqliteContentEngineAdapter } from "./engine/sqlite.js";
import { resolveAccess } from "./access.js";
import { permissionKeyFor } from "./permissions.js";

function freshAdapters() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-access-test-"));
  const file = join(dir, "content.sqlite");
  const schema = createSqliteContentEngineAdapter({ engine: "sqlite", file });
  const entries = createSqliteContentEntryEngineAdapter({ engine: "sqlite", file });
  return { schema, entries, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function createUser(entries: ReturnType<typeof createSqliteContentEntryEngineAdapter>, userType: any, allTypes: any, roleIds: number[]) {
  return entries.createEntry(userType, allTypes, {
    name: "Test User",
    email: `test-${Math.random()}@example.com`,
    password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue,
    roles: roleIds,
  });
}

describe("resolveAccess", () => {
  it("denies everything for a user with no roles", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;

    const user = await createUser(entries, userType, allTypes, []);
    const access = await resolveAccess(entries, allTypes, { id: user.id, name: "Test User", email: "test@example.com" });

    expect(access?.isSuperAdmin).toBe(false);
    expect(access?.can(userType.id, "view")).toBe(false);
  });

  it("grants only the specific (resource, action) pair a role's permissions include", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;

    const role = await entries.createEntry(roleType, allTypes, {
      name: "Viewer",
      description: "",
      isSuperAdmin: false,
      permissions: [permissionKeyFor(userType.id, "view")],
    });
    const user = await createUser(entries, userType, allTypes, [role.id]);
    const access = await resolveAccess(entries, allTypes, { id: user.id, name: "Test User", email: "test@example.com" });

    expect(access?.isSuperAdmin).toBe(false);
    expect(access?.can(userType.id, "view")).toBe(true);
    expect(access?.can(userType.id, "update")).toBe(false);
    expect(access?.can(userType.id, "delete")).toBe(false);
  });

  it("isSuperAdmin bypasses every check, even with zero explicit grants", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;

    const role = await entries.createEntry(roleType, allTypes, {
      name: "Super",
      description: "",
      isSuperAdmin: true,
      permissions: [],
    });
    const user = await createUser(entries, userType, allTypes, [role.id]);
    const access = await resolveAccess(entries, allTypes, { id: user.id, name: "Test User", email: "test@example.com" });

    expect(access?.isSuperAdmin).toBe(true);
    expect(access?.can(userType.id, "view")).toBe(true);
    expect(access?.can("anything-not-even-a-real-resource-id", "delete")).toBe(true);
  });

  it("returns null when the session names a user that no longer exists", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();

    const access = await resolveAccess(entries, allTypes, { id: 999_999, name: "Ghost", email: "ghost@example.com" });
    expect(access).toBeNull();
  });
});
