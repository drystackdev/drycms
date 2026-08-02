import type { Statement } from "./migration.js";
import type { ContentTypeDefinition } from "./types.js";

/** The actions a role can be granted on a resource. A collection gets
 * View/Create/Update/Delete plus Publish when Draft is enabled; a singleton
 * gets the single Setting action; components get none. */
export const PERMISSION_ACTIONS = ["view", "create", "update", "delete", "publish", "setting"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Stable value stored in `role.permissions`; it references content-type
 * metadata directly instead of requiring a second permission table. */
export function permissionKeyFor(resourceId: string, action: PermissionAction): string {
  return `${resourceId}:${action}`;
}

/** The seeded Super Admin role's bypass flag - server-only behavior, never a
 * browser-facing editable/display column. */
export const SUPER_ADMIN_FIELD_NAME = "isSuperAdmin";

/** The exact actions the Role editor and request authorization expose for a
 * content type. Pure and safe to import from client code. */
export function permissionActionsFor(target: ContentTypeDefinition): PermissionAction[] {
  if (target.kind === "component") return [];
  if (target.kind === "singleton") return ["setting"];
  return target.features?.draft
    ? ["view", "create", "update", "delete", "publish"]
    : ["view", "create", "update", "delete"];
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
