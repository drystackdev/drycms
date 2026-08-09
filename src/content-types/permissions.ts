import type { Statement } from "./migration.js";
import type { ContentTypeDefinition } from "./types.js";

/** The actions a role can be granted on a resource. A collection gets
 * View/Create/Update/Delete/Magic; a singleton gets Setting/Magic;
 * components get none, and neither do the configuration resources listed in
 * `NO_MAGIC_TYPE_NAMES`/`UNGRANTABLE_TYPE_NAMES` below (see
 * `permissionActionsFor`). `magic` is the explicit, stored grant for using
 * Magic (AI) on a resource's entries - checked directly server-side
 * (`ai-magic-write.ts`), never derived from create/update/setting at
 * request time. The Role editor only lets it be TURNED ON once one of those
 * is already granted (see `RoleEditor.tsx`'s `permissionPrerequisites`),
 * but the grant itself is what's actually checked. */
export const PERMISSION_ACTIONS = ["view", "create", "update", "delete", "setting", "magic"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Stable value stored in `role.permissions`; it references content-type
 * metadata directly instead of requiring a second permission table. */
export function permissionKeyFor(resourceId: string, action: PermissionAction): string {
  return `${resourceId}:${action}`;
}

/** The seeded Super Admin role's bypass flag - server-only behavior, never a
 * browser-facing editable/display column. */
export const SUPER_ADMIN_FIELD_NAME = "isSuperAdmin";

/** Synthetic resource id for Component Builder's Role-editor toggle - it has
 * no real `ContentTypeDefinition` row (same idea as `RoleEditor.tsx`'s
 * other `SYSTEM_RESOURCES` entries), so the id is a fixed string shared
 * between `RoleEditor.tsx` (renders the toggle) and `admin-access.ts`'s
 * `requirePermission` route gate (checks it), rather than each side
 * hard-coding its own copy. */
export const PAGE_COMPONENTS_RESOURCE_ID = "system-page-components";

/** Same synthetic-resource pattern as `PAGE_COMPONENTS_RESOURCE_ID` above,
 * one id per admin page that isn't backed by a real `ContentTypeDefinition`
 * - grouped together in `RoleEditor.tsx`'s "System" fieldset, checked at the
 * matching route (`handler.ts`/`content-types.ts`) with
 * `requirePermission(context, id, "setting")`, same as Page Components.
 *
 * (There used to be a `system-key-value` entry here too, for the admin
 * Key Value browser - removed 2026-08-07 along with that whole page/route,
 * see `status/key-value-system.md`. The underlying `kv/` store engine it
 * browsed is unrelated infrastructure - unaffected, still used by
 * `server/auth-security.ts` for session revocation/rate-limiting. A
 * `system-media` entry and a `system-vei` entry - gating the Media page and
 * the Visual Editing Interface respectively - also used to live here,
 * removed 2026-08-07: both are now open to any authenticated user rather
 * than a grantable permission, see `Media.tsx` and `vei-routes.ts`'s
 * `handleVeiRoute`.) */
export const ICON_MANAGEMENT_RESOURCE_ID = "system-icon-management";
export const RICHTEXT_COMPONENTS_RESOURCE_ID = "system-richtext-components";
export const CONTENT_TYPES_RESOURCE_ID = "system-content-types";
/** Gates `src/apps/pages/**` code edits AND triggering a page build/rebuild
 * / reading published content over `dry-http` (`plans/app-r2.md` mục 12,
 * `routes/dry-http.ts`, `routes/pages-build.ts`, `routes/pages-source.ts`).
 * Originally 2 separate toggles (`plans/app-r2.md` quyết định #12,
 * "sửa code = chạy code") - merged into one in practice, editing code and
 * publishing it were never granted independently. Keeps the `"system-build"`
 * string value (not a fresh id) so a role that already had Page Build access
 * isn't silently locked out by the merge. */
export const PAGE_BUILDER_RESOURCE_ID = "system-build";

/** Content types no role permission applies to AT ALL - `permissionActionsFor`
 * returns `[]`, so the Role editor and the Dashboard's permission summary drop
 * the row entirely (both already filter on "has at least one action", the same
 * way components are dropped). `memory` is the only one: it's server-managed
 * per-account state whose ONLY access path is `routes/memory.ts`
 * (`/api/memory`), which always scopes to the calling session's own user id and
 * never consults the content-entries permission model - so a grant on it would
 * control exactly nothing while still asking an admin to reason about it. */
const UNGRANTABLE_TYPE_NAMES: ReadonlySet<string> = new Set(["memory"]);

/** Content types that never expose Magic (AI) - configuration rather than
 * editorial content: credentials (`aiKey`), access control (`role`/`user`),
 * routing/navigation (`redirect`/`menu`), and the settings singletons
 * (`systemSettings`/`siteSettings`/`googleVerification`/`githubSync`). None of them hold
 * prose a model should be authoring - an API key, a permission set, a redirect
 * target, or a verification token is either exact or wrong.
 *
 * Matched by `name`, not `id`: the seeded system types have fixed ids, but an
 * app's own settings singleton (`siteSettings`) gets a generated one, so `name`
 * is the only key both kinds share. Editorial types keep Magic, including
 * `seoDefaults` (real meta title/description copy). */
const NO_MAGIC_TYPE_NAMES: ReadonlySet<string> = new Set([
  "aiKey",
  "role",
  "user",
  "redirect",
  "menu",
  "systemSettings",
  "siteSettings",
  "googleVerification",
  "githubSync",
]);

/** Whether Magic (AI) applies to this content type at all - a property of the
 * SCHEMA, checked separately from the `magic` grant. Both are needed: dropping
 * the `magic` switch from the Role editor alone would still leave the Magic UI
 * live for a Super Admin, who bypasses every grant. Enforced client-side
 * (`ContentEntryEditor.tsx`, which also feeds RichText's "Rewrite selection")
 * and server-side (`routes/ai-magic-write.ts`). */
export function supportsMagic(target: ContentTypeDefinition): boolean {
  if (target.kind === "component") return false;
  if (UNGRANTABLE_TYPE_NAMES.has(target.name)) return false;
  return !NO_MAGIC_TYPE_NAMES.has(target.name);
}

/** The exact actions the Role editor and request authorization expose for a
 * content type. Pure and safe to import from client code. */
export function permissionActionsFor(target: ContentTypeDefinition): PermissionAction[] {
  if (target.kind === "component") return [];
  if (UNGRANTABLE_TYPE_NAMES.has(target.name)) return [];
  const magic: PermissionAction[] = supportsMagic(target) ? ["magic"] : [];
  if (target.kind === "singleton") return ["setting", ...magic];
  return ["view", "create", "update", "delete", ...magic];
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
