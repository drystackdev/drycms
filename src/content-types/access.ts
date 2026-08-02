import type { SessionPayload } from "../lib/session-token.js";
import type { ContentEntryEngineAdapter } from "./engine/entries-types.js";
import { permissionKeyFor, type PermissionAction } from "./permissions.js";
import type { ContentTypeDefinition } from "./types.js";

export interface AccessInfo {
  userId: number;
  isSuperAdmin: boolean;
  /** The resolved keys are sent to the authenticated client for UI hints.
   * Server routes must still call `can()` because this list is user input
   * from the browser once it crosses the API boundary. */
  permissions: readonly string[];
  /** Whether this session's user can perform `action` on the content type
   * whose id is `resourceId`. Always `true` once
   * `isSuperAdmin` is set - callers never need to special-case that
   * themselves. */
  can(resourceId: string, action: PermissionAction): boolean;
}

/**
 * Resolves what `session`'s user is currently allowed to do - fresh on every
 * call, no caching across requests, so revoking a role grant takes
 * effect on the very next request rather than only at the user's next login
 * (a deliberately stricter contract than `session-token.ts`'s own payload,
 * which happily lets `name`/`email` go stale until then - access
 * revocation is more security-sensitive than a display name being wrong for
 * a while). Returns `null` if `session` names a `user` row that no longer
 * exists (deleted after the token was issued).
 */
export async function resolveAccess(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  session: SessionPayload,
): Promise<AccessInfo | null> {
  const userType = allTypes.find((t) => t.name === "user");
  const roleType = allTypes.find((t) => t.name === "role");
  if (!userType || !roleType) return null;

  const user = await entryAdapter.getEntry(userType, allTypes, session.id);
  if (!user) return null;

  const roleIds = Array.isArray(user.value.roles) ? (user.value.roles as number[]) : [];
  const deny: AccessInfo = { userId: session.id, isSuperAdmin: false, permissions: [], can: () => false };
  if (roleIds.length === 0) return deny;

  // `listEntries` deliberately never populates relation-many fields (see
  // `entries-sqlite.ts`'s `listEntries` vs `getEntry`/`populateChildFields`)
  // - `role.permissions` is `manyToMany`, so each of THIS user's roles has to
  // be read via `getEntry` individually rather than listed. Small either way
  // (a user rarely has more than a couple of roles), so this is also
  // cheaper than the "fetch every role" alternative would have been.
  const myRoles = (
    await Promise.all(roleIds.map((id) => entryAdapter.getEntry(roleType, allTypes, id)))
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  if (myRoles.some((r) => r.value.isSuperAdmin === true)) {
    return { userId: session.id, isSuperAdmin: true, permissions: [], can: () => true };
  }

  const grantedPermissionKeys = new Set<string>();
  for (const role of myRoles) {
    const keys = Array.isArray(role.value.permissions) ? (role.value.permissions as string[]) : [];
    for (const key of keys) grantedPermissionKeys.add(key);
  }
  if (grantedPermissionKeys.size === 0) return deny;

  return {
    userId: session.id,
    isSuperAdmin: false,
    permissions: [...grantedPermissionKeys],
    can: (resourceId, action) => grantedPermissionKeys.has(permissionKeyFor(resourceId, action)),
  };
}
