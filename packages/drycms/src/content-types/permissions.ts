import type { Statement } from "./migration.js";
import type { ContentTypeDefinition } from "./types.js";

/**
 * A deliberate, narrow exception to the "schema-definition only" boundary
 * documented in `engine/types.ts`: raw row-level SQL for exactly the `role`
 * and `permission` tables (see `status/role-permission.md`), not a general
 * row-CRUD feature. `role`/`permission` are `system: true` + `structureLocked:
 * true` (see `seed.ts`), so their table/column names below can never change.
 */

/** Upserts a `permission` row for a saved collection/singleton, keyed by
 * `idTable` (the content type's own id) - keeps its `name` in sync with the
 * content type's current name. Components never get a table of their own,
 * so they're skipped entirely (no permission row makes sense for them). */
export function permissionSyncStatement(target: ContentTypeDefinition): Statement | undefined {
  if (target.kind === "component") return undefined;
  return {
    sql:
      `INSERT INTO "permission" ("name","idTable") VALUES (?, ?)\n` +
      `ON CONFLICT("idTable") DO UPDATE SET "name" = excluded."name";`,
    params: [target.name, target.id],
    description: `Sync permission row for "${target.name}"`,
  };
}

/** Removes a deleted content type's now-meaningless `permission` row. */
export function permissionDeleteStatement(target: ContentTypeDefinition): Statement | undefined {
  if (target.kind === "component") return undefined;
  return {
    sql: `DELETE FROM "permission" WHERE "idTable" = ?;`,
    params: [target.id],
    description: `Remove permission row for "${target.name}"`,
  };
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
