import { permissionActionsFor, SUPER_ADMIN_DESCRIPTION } from "../../permissions.js";
import type { ContentTypeDefinition } from "../../types.js";
import type { ContentEntryEngineAdapter } from "../entries-types.js";
import { createFileEntry, deleteFileEntry, updateFileEntry } from "./entries-file.js";
import type { FileDriver } from "./file-driver.js";

/**
 * File-engine counterpart to `permissions.ts` - same responsibility
 * (idempotently sync one `permission` row per (collection/singleton x
 * action), seed the permanent Super Admin role), but implemented by calling
 * the entry engine's OWN create/update/list instead of hand-written SQL -
 * simpler here, since there's no raw-statement layer to reach through.
 * `permission`/`role` are found by `kind`+`name`, not a fixed id, the exact
 * same (documented) fragility `permissions.ts` already has: both hardcode
 * literal identifiers (`"permission"`/`"role"` as SQL table names there, as
 * `type.name` here) rather than resolving through the built-in-type ids in
 * `seed.ts` (module-private, not exported) - renaming either type breaks
 * this the same way it already breaks `permissions.ts`.
 *
 * Reads go through `entryAdapter` (plain, uncommitted `listEntries`); writes
 * go through `driver` directly, using the driver-parameterized
 * `createFileEntry`/`updateFileEntry`/`deleteFileEntry` from `entries-file.ts`
 * inside ONE shared `driver.transaction()` per sync pass - a fresh repo/
 * branch can mean dozens of permission rows at boot, and going through
 * `entryAdapter.createEntry` for each would turn first boot into dozens of
 * sequential writes instead of one.
 */

const LIST_ALL_QUERY = { page: 0, pageSize: 1_000_000 } as const;

function findByName(allTypes: ContentTypeDefinition[], name: string): ContentTypeDefinition | undefined {
  return allTypes.find((t) => t.kind === "collection" && t.name === name);
}

/** Called after every `applySave` - keeps `permission` in sync with the
 * FULL current type list (not just the one just saved), and (re-)seeds
 * Super Admin. Idempotent and cheap enough to run unconditionally, same as
 * `sqlite.ts`'s boot-time sync. */
export async function syncFilePermissions(driver: FileDriver, entryAdapter: ContentEntryEngineAdapter, allTypes: ContentTypeDefinition[]): Promise<void> {
  const permissionType = findByName(allTypes, "permission");
  const roleType = findByName(allTypes, "role");
  if (!permissionType && !roleType) return;

  // Reads reflect whatever's already committed - independent of the batched
  // writes below, same as before this only read once up front.
  const existingPermissions = permissionType ? (await entryAdapter.listEntries(permissionType, allTypes, LIST_ALL_QUERY)).rows : [];
  const existingRoles = roleType ? (await entryAdapter.listEntries(roleType, allTypes, LIST_ALL_QUERY)).rows : [];

  await driver.transaction(async (tx) => {
    if (permissionType) {
      const byKey = new Map(existingPermissions.map((r) => [`${r.value.idTable}:${r.value.action}`, r]));
      for (const target of allTypes.filter((t) => t.kind !== "component")) {
        const expected = new Set<string>(permissionActionsFor(target));
        // Stale rows first - an action this target no longer expects (e.g.
        // an old "read"/"edit" row from before this scheme existed, or
        // "publish" after Draft got turned off) - mirrors `permissions.ts`'s
        // SQL `DELETE ... NOT IN (...)`.
        for (const row of existingPermissions) {
          if (row.value.idTable === target.id && !expected.has(row.value.action as string)) {
            await deleteFileEntry(tx, permissionType, allTypes, row.id);
          }
        }
        for (const action of expected) {
          const row = byKey.get(`${target.id}:${action}`);
          if (!row) {
            await createFileEntry(tx, permissionType, allTypes, { name: target.name, idTable: target.id, action });
          } else if (row.value.name !== target.name) {
            await updateFileEntry(tx, permissionType, allTypes, row.id, { ...row.value, name: target.name });
          }
        }
      }
    }

    if (roleType && !existingRoles.some((r) => r.value.name === "Super Admin")) {
      await createFileEntry(tx, roleType, allTypes, {
        name: "Super Admin",
        description: SUPER_ADMIN_DESCRIPTION,
        isSuperAdmin: true,
        permissions: [],
      });
    }
  });
}

/** Called from `deleteContentType` - removes a deleted type's now-meaningless
 * `permission` rows (every action row shares `idTable`). `allTypes` is the
 * list BEFORE `removedTypeId` is removed from it - only needed to resolve
 * the `permission` type itself. */
export async function deleteFilePermissions(driver: FileDriver, entryAdapter: ContentEntryEngineAdapter, allTypes: ContentTypeDefinition[], removedTypeId: string): Promise<void> {
  const permissionType = findByName(allTypes, "permission");
  if (!permissionType) return;
  const existing = (await entryAdapter.listEntries(permissionType, allTypes, LIST_ALL_QUERY)).rows;
  const toRemove = existing.filter((row) => row.value.idTable === removedTypeId);
  if (toRemove.length === 0) return;

  await driver.transaction(async (tx) => {
    for (const row of toRemove) {
      await deleteFileEntry(tx, permissionType, allTypes, row.id);
    }
  });
}
