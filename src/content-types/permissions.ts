import type { Statement } from "./migration.js";
import type { ContentTypeDefinition } from "./types.js";

/**
 * A deliberate, narrow exception to the "schema-definition only" boundary
 * documented in `engine/types.ts`: raw row-level SQL for exactly the `role`
 * and `permission` tables (see `status/role-permission.md`), not a general
 * row-CRUD feature.
 */

/** The four actions a role can be granted on a collection/singleton -
 * governs one `permission` row per resource per action (e.g. so a role can
 * be granted "create" on `note` without also granting "delete"). */
export const PERMISSION_ACTIONS = ["create", "read", "edit", "delete"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** `idTable` alone is no longer unique - 4 rows (one per action) now share
 * the same `idTable` for a given resource - so uniqueness is enforced on the
 * (`idTable`,`action`) pair instead, via this manually-created composite
 * index (the generic field-validation system only supports single-column
 * `unique`, see `migration.ts`). Must run once the `permission` table
 * exists, before any sync statement. */
export function permissionUniqueIndexStatement(): Statement {
  return {
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ux_permission_idtable_action" ON "permission"("idTable","action");`,
    description: "Ensure a composite unique index on permission(idTable, action)",
  };
}

/** Upserts one `permission` row per action (see `PERMISSION_ACTIONS`) for a
 * saved collection/singleton, keyed by (`idTable`,`action`) - keeps each
 * row's `name` in sync with the content type's current name (the action
 * itself lives in its own column, not baked into `name`). Components never
 * get a table of their own, so they're skipped entirely (no permission row
 * makes sense for them). */
export function permissionSyncStatements(target: ContentTypeDefinition): Statement[] {
  if (target.kind === "component") return [];
  return PERMISSION_ACTIONS.map((action) => ({
    sql:
      `INSERT INTO "permission" ("name","idTable","action") VALUES (?, ?, ?)\n` +
      `ON CONFLICT("idTable","action") DO UPDATE SET "name" = excluded."name";`,
    params: [target.name, target.id, action],
    description: `Sync "${action}" permission row for "${target.name}"`,
  }));
}

/** Removes a deleted content type's now-meaningless `permission` rows - all
 * actions share `idTable`, so one statement clears all 4. */
export function permissionDeleteStatements(target: ContentTypeDefinition): Statement[] {
  if (target.kind === "component") return [];
  return [
    {
      sql: `DELETE FROM "permission" WHERE "idTable" = ?;`,
      params: [target.id],
      description: `Remove permission rows for "${target.name}"`,
    },
  ];
}

/** The permanent Super Admin role, seeded at boot - no relations, but meant
 * to bypass every permission check once enforcement exists (see the spec).
 * `ON CONFLICT DO NOTHING` keyed by `name` makes this idempotent across every
 * boot, not just the first one. */
export function superAdminSeedStatement(): Statement {
  return {
    sql:
      `INSERT INTO "role" ("name","isSuperAdmin") VALUES (?, ?)\n` +
      `ON CONFLICT("name") DO NOTHING;`,
    params: ["Super Admin", 1],
    description: "Seed the permanent Super Admin role",
  };
}
