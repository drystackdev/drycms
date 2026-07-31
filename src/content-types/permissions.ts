import type { Statement } from "./migration.js";
import type { ContentTypeDefinition } from "./types.js";

/**
 * A deliberate, narrow exception to the "schema-definition only" boundary
 * documented in `engine/types.ts`: raw row-level SQL for exactly the `role`
 * and `permission` tables (see `status/role-permission.md`), not a general
 * row-CRUD feature.
 */

/** The actions a role can be granted on a resource - governs one
 * `permission` row per resource per action (e.g. so a role can be granted
 * "create" on `note` without also granting "delete"). A collection gets
 * View/Create/Update/Delete plus Publish (only when it has `features.draft`
 * on - there's no publish workflow to gate otherwise); a singleton gets the
 * single "setting" action (it's one row, not four - see `permissionActionsFor`). */
export const PERMISSION_ACTIONS = ["view", "create", "update", "delete", "publish", "setting"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** The exact set of actions `permissionSyncStatements` (and the Role editor
 * UI, which imports this directly to stay in lockstep) should generate for
 * `target`. Pure - safe to import from client code too. */
export function permissionActionsFor(target: ContentTypeDefinition): PermissionAction[] {
  if (target.kind === "component") return [];
  if (target.kind === "singleton") return ["setting"];
  return target.features?.draft
    ? ["view", "create", "update", "delete", "publish"]
    : ["view", "create", "update", "delete"];
}

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

/** Upserts one `permission` row per action `permissionActionsFor(target)`
 * expects, keyed by (`idTable`,`action`) - keeps each row's `name` in sync
 * with the content type's current name (the action itself lives in its own
 * column, not baked into `name`). Also deletes any row for this `idTable`
 * whose `action` ISN'T in that expected set - the self-healing step that
 * migrates a resource's rows when the expected set changes (e.g. an old
 * "read"/"edit" row from before this scheme existed, or a collection whose
 * Draft feature just got turned off and no longer wants a "publish" row).
 * Components never get a table of their own, so they're skipped entirely
 * (no permission row makes sense for them). */
export function permissionSyncStatements(target: ContentTypeDefinition): Statement[] {
  if (target.kind === "component") return [];
  const expected = permissionActionsFor(target);
  const statements: Statement[] = [
    {
      sql: `DELETE FROM "permission" WHERE "idTable" = ? AND "action" NOT IN (${expected.map(() => "?").join(",")});`,
      params: [target.id, ...expected],
      description: `Remove stale permission rows for "${target.name}"`,
    },
  ];
  for (const action of expected) {
    statements.push({
      sql:
        `INSERT INTO "permission" ("name","idTable","action") VALUES (?, ?, ?)\n` +
        `ON CONFLICT("idTable","action") DO UPDATE SET "name" = excluded."name";`,
      params: [target.name, target.id, action],
      description: `Sync "${action}" permission row for "${target.name}"`,
    });
  }
  return statements;
}

/** Removes a deleted content type's now-meaningless `permission` rows - every
 * action row shares `idTable`, so one statement clears all of them regardless
 * of how many `permissionActionsFor` would have generated. */
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

/** `isSuperAdmin` is a bypass switch, not an ordinary role attribute - it's
 * only ever meant to be true for this one permanent seeded role, never
 * something an admin toggles on a role through the editor (see
 * `RoleEditor.tsx`, which deliberately excludes the field for that reason).
 * Shared between this file's SQL seed statement and the file-engine's
 * `permissions-file.ts` seed call so both stay in sync. */
export const SUPER_ADMIN_DESCRIPTION = "Bypasses every permission check - full, unrestricted access.";

/** The permanent Super Admin role, seeded at boot - no relations, but meant
 * to bypass every permission check once enforcement exists (see the spec).
 * `ON CONFLICT DO NOTHING` keyed by `name` makes this idempotent across every
 * boot, not just the first one. */
export function superAdminSeedStatement(): Statement {
  return {
    sql:
      `INSERT INTO "role" ("name","description","isSuperAdmin") VALUES (?, ?, ?)\n` +
      `ON CONFLICT("name") DO NOTHING;`,
    params: ["Super Admin", SUPER_ADMIN_DESCRIPTION, 1],
    description: "Seed the permanent Super Admin role",
  };
}
