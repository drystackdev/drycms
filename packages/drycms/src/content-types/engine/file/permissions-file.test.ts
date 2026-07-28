import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentTypeDefinition } from "../../types.js";
import { createFileContentEntryEngineAdapter } from "./entries-file.js";
import { createFileDriver } from "./file-driver.js";
import { deleteFilePermissions, syncFilePermissions } from "./permissions-file.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function freshSetup() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-permissions-file-test-"));
  dirs.push(dir);
  const option = { engine: "file" as const, kind: "local" as const, root: dir };
  return { driver: createFileDriver(option), entries: createFileContentEntryEngineAdapter(option) };
}

const permissionType: ContentTypeDefinition = {
  id: "t-permission",
  kind: "collection",
  name: "permission",
  label: "Permission",
  fields: [
    { id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: { required: true }, order: 0 },
    { id: "f-idTable", name: "idTable", label: "Table", type: "text", config: {}, validation: { required: true }, order: 1 },
    { id: "f-action", name: "action", label: "Action", type: "text", config: {}, validation: { required: true }, order: 2 },
  ],
  version: 0,
};

const roleType: ContentTypeDefinition = {
  id: "t-role",
  kind: "collection",
  name: "role",
  label: "Role",
  fields: [
    { id: "f-role-name", name: "name", label: "Name", type: "text", config: {}, validation: { required: true, unique: true }, order: 0 },
    { id: "f-isSuperAdmin", name: "isSuperAdmin", label: "Super Admin", type: "boolean", config: {}, validation: {}, order: 1 },
    { id: "f-permissions", name: "permissions", label: "Permissions", type: "relation", config: { target: permissionType.id, cardinality: "manyToMany" }, validation: {}, order: 2 },
  ],
  version: 0,
};

/** `syncFilePermissions` seeds 4 rows (`PERMISSION_ACTIONS`) for every
 * collection/singleton in `allTypes`, INCLUDING `permission`/`role`
 * themselves - `resourceCount` extra resource types on top of those two
 * always means `(resourceCount + 2) * 4` total rows. */
function makeResourceTypes(count: number): ContentTypeDefinition[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t-resource-${i}`,
    kind: "collection" as const,
    name: `resource${i}`,
    label: `Resource ${i}`,
    fields: [],
    version: 0,
  }));
}

describe("syncFilePermissions", () => {
  it("creates every missing permission row + the Super Admin role in ONE transaction, regardless of row count", async () => {
    const { driver, entries } = freshSetup();
    const resources = makeResourceTypes(6);
    const allTypes = [permissionType, roleType, ...resources];

    const transactionSpy = vi.spyOn(driver, "transaction");
    await syncFilePermissions(driver, entries, allTypes);

    // One shared commit/transaction for the whole seed pass, not one per row.
    expect(transactionSpy).toHaveBeenCalledTimes(1);

    const { rows } = await entries.listEntries(permissionType, allTypes, { page: 0, pageSize: 1000 });
    expect(rows).toHaveLength((6 + 2) * 4);

    const { rows: roles } = await entries.listEntries(roleType, allTypes, { page: 0, pageSize: 10 });
    expect(roles.map((r) => r.value.name)).toEqual(["Super Admin"]);
  });

  it("is idempotent - a second run changes nothing and still opens exactly one transaction", async () => {
    const { driver, entries } = freshSetup();
    const allTypes = [permissionType, roleType, ...makeResourceTypes(2)];
    await syncFilePermissions(driver, entries, allTypes);

    const transactionSpy = vi.spyOn(driver, "transaction");
    await syncFilePermissions(driver, entries, allTypes);
    expect(transactionSpy).toHaveBeenCalledTimes(1);

    const { rows } = await entries.listEntries(permissionType, allTypes, { page: 0, pageSize: 1000 });
    expect(rows).toHaveLength((2 + 2) * 4);
  });

  it("renames a resource's rows on the next sync instead of duplicating them", async () => {
    const { driver, entries } = freshSetup();
    const [resource] = makeResourceTypes(1);
    const allTypes = [permissionType, roleType, resource!];
    await syncFilePermissions(driver, entries, allTypes);

    const renamed = { ...resource!, name: "renamedResource" };
    await syncFilePermissions(driver, entries, [permissionType, roleType, renamed]);

    const { rows } = await entries.listEntries(permissionType, allTypes, { page: 0, pageSize: 1000 });
    const forResource = rows.filter((r) => r.value.idTable === resource!.id);
    expect(forResource).toHaveLength(4);
    expect(forResource.every((r) => r.value.name === "renamedResource")).toBe(true);
  });
});

describe("deleteFilePermissions", () => {
  it("removes every permission row for the deleted type, in one transaction", async () => {
    const { driver, entries } = freshSetup();
    const resources = makeResourceTypes(3);
    const allTypes = [permissionType, roleType, ...resources];
    await syncFilePermissions(driver, entries, allTypes);

    const transactionSpy = vi.spyOn(driver, "transaction");
    await deleteFilePermissions(driver, entries, allTypes, resources[0]!.id);
    expect(transactionSpy).toHaveBeenCalledTimes(1);

    const { rows } = await entries.listEntries(permissionType, allTypes, { page: 0, pageSize: 1000 });
    expect(rows).toHaveLength((3 + 2) * 4 - 4);
    expect(rows.every((r) => r.value.idTable !== resources[0]!.id)).toBe(true);
  });

  it("opens no transaction at all when there's nothing to remove", async () => {
    const { driver, entries } = freshSetup();
    const allTypes = [permissionType, roleType];
    await syncFilePermissions(driver, entries, allTypes);

    const transactionSpy = vi.spyOn(driver, "transaction");
    await deleteFilePermissions(driver, entries, allTypes, "some-type-with-no-rows");
    expect(transactionSpy).not.toHaveBeenCalled();
  });
});
