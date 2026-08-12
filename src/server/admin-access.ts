import type { DryRouteContext } from "./context.js";
import { resolveAccessCached } from "../content-types/access.js";
import type { PermissionAction } from "../content-types/permissions.js";
import { getContentAdapters } from "./content-adapters.js";
import { forbiddenResponse, unauthenticatedResponse } from "./route-helpers.js";

/** Central authorization for APIs that mutate server-managed assets. Keeping
 * this at the dispatcher boundary prevents a route added later from relying
 * only on a UI-only "admin" flag. */
export async function requireSuperAdmin(context: DryRouteContext, message = "Super administrator access is required."): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccessCached(context, entries, allTypes, context.session);
  if (!access) return unauthenticatedResponse();
  return access.isSuperAdmin ? null : forbiddenResponse(message);
}

/** Soft variant of `requireSuperAdmin` - resolves the same access, but
 * returns a boolean instead of a 401/403 response, for callers that adjust
 * behavior (e.g. what a listing includes) rather than gate the whole
 * request. `false` for a missing or unresolvable session. */
export async function isSuperAdminSession(context: DryRouteContext): Promise<boolean> {
  if (!context.session) return false;
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccessCached(context, entries, allTypes, context.session);
  return access?.isSuperAdmin === true;
}

/** Same shape as `requireSuperAdmin`, but for a single `role.permissions`
 * key rather than the `isSuperAdmin` bypass - for a route backing a page
 * that isn't a real content type (so `content-types/access.ts`'s normal
 * `(contentTypeId, action)` lookup has nothing to key off), granted through
 * a synthetic resource id a Role editor screen exposes as one more toggle
 * (see `RoleEditor.tsx`'s `PAGE_COMPONENTS_RESOURCE`). */
export async function requirePermission(
  context: DryRouteContext,
  resourceId: string,
  action: PermissionAction,
  message = "You don't have permission to do this.",
): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccessCached(context, entries, allTypes, context.session);
  if (!access) return unauthenticatedResponse();
  return access.can(resourceId, action) ? null : forbiddenResponse(message);
}
