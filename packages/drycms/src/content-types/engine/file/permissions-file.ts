import { PERMISSION_ACTIONS } from "../../permissions.js";
import type { ContentTypeDefinition } from "../../types.js";
import type { ContentEntryEngineAdapter } from "../entries-types.js";

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
 */

const LIST_ALL_QUERY = { page: 0, pageSize: 1_000_000 } as const;

function findByName(allTypes: ContentTypeDefinition[], name: string): ContentTypeDefinition | undefined {
  return allTypes.find((t) => t.kind === "collection" && t.name === name);
}

/** Called after every `applySave` - keeps `permission` in sync with the
 * FULL current type list (not just the one just saved), and (re-)seeds
 * Super Admin. Idempotent and cheap enough to run unconditionally, same as
 * `sqlite.ts`'s boot-time sync. */
export async function syncFilePermissions(entryAdapter: ContentEntryEngineAdapter, allTypes: ContentTypeDefinition[]): Promise<void> {
  const permissionType = findByName(allTypes, "permission");
  if (permissionType) {
    const existing = (await entryAdapter.listEntries(permissionType, allTypes, LIST_ALL_QUERY)).rows;
    const byKey = new Map(existing.map((r) => [`${r.value.idTable}:${r.value.action}`, r]));

    for (const target of allTypes.filter((t) => t.kind !== "component")) {
      for (const action of PERMISSION_ACTIONS) {
        const row = byKey.get(`${target.id}:${action}`);
        if (!row) {
          await entryAdapter.createEntry(permissionType, allTypes, { name: target.name, idTable: target.id, action });
        } else if (row.value.name !== target.name) {
          await entryAdapter.updateEntry(permissionType, allTypes, row.id, { ...row.value, name: target.name });
        }
      }
    }
  }

  const roleType = findByName(allTypes, "role");
  if (roleType) {
    const existing = (await entryAdapter.listEntries(roleType, allTypes, LIST_ALL_QUERY)).rows;
    if (!existing.some((r) => r.value.name === "Super Admin")) {
      await entryAdapter.createEntry(roleType, allTypes, { name: "Super Admin", isSuperAdmin: true, permissions: [] });
    }
  }
}

/** Called from `deleteContentType` - removes a deleted type's now-meaningless
 * `permission` rows (all 4 actions share `idTable`). `allTypes` is the list
 * BEFORE `removedTypeId` is removed from it - only needed to resolve the
 * `permission` type itself. */
export async function deleteFilePermissions(entryAdapter: ContentEntryEngineAdapter, allTypes: ContentTypeDefinition[], removedTypeId: string): Promise<void> {
  const permissionType = findByName(allTypes, "permission");
  if (!permissionType) return;
  const existing = (await entryAdapter.listEntries(permissionType, allTypes, LIST_ALL_QUERY)).rows;
  for (const row of existing) {
    if (row.value.idTable === removedTypeId) {
      await entryAdapter.deleteEntry(permissionType, allTypes, row.id);
    }
  }
}
