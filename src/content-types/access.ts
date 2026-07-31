import type { SessionPayload } from "../lib/session-token.js";
import type { ContentEntryEngineAdapter } from "./engine/entries-types.js";
import type { PermissionAction } from "./permissions.js";
import type { ContentTypeDefinition } from "./types.js";

const FETCH_ALL_SIZE = 10_000;

export interface AccessInfo {
  userId: number;
  isSuperAdmin: boolean;
  /** Whether this session's user can perform `action` on the content type
   * whose id is `resourceId` (`permission.idTable`). Always `true` once
   * `isSuperAdmin` is set - callers never need to special-case that
   * themselves. */
  can(resourceId: string, action: PermissionAction): boolean;
}

/**
 * Resolves what `session`'s user is currently allowed to do - fresh on every
 * call, no caching across requests, so revoking a role/permission takes
 * effect on the very next request rather than only at the user's next login
 * (a deliberately stricter contract than `session-token.ts`'s own payload,
 * which happily lets `name`/`email` go stale until then - permission
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
  const permissionType = allTypes.find((t) => t.name === "permission");
  if (!userType || !roleType || !permissionType) return null;

  const user = await entryAdapter.getEntry(userType, allTypes, session.id);
  if (!user) return null;

  const roleIds = Array.isArray(user.value.roles) ? (user.value.roles as number[]) : [];
  const deny: AccessInfo = { userId: session.id, isSuperAdmin: false, can: () => false };
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
    return { userId: session.id, isSuperAdmin: true, can: () => true };
  }

  const grantedPermissionIds = new Set<number>();
  for (const role of myRoles) {
    const ids = Array.isArray(role.value.permissions) ? (role.value.permissions as number[]) : [];
    for (const id of ids) grantedPermissionIds.add(id);
  }
  if (grantedPermissionIds.size === 0) return deny;

  // `permission` rows have no relation-many fields of their own (`idTable`/
  // `action` are plain columns) - `listEntries` is correct and cheap here,
  // no `getEntry`-per-row needed like the roles above.
  const permissionsPage = await entryAdapter.listEntries(permissionType, allTypes, { page: 0, pageSize: FETCH_ALL_SIZE });
  const granted = permissionsPage.rows.filter((p) => grantedPermissionIds.has(p.id));

  return {
    userId: session.id,
    isSuperAdmin: false,
    can: (resourceId, action) => granted.some((p) => p.value.idTable === resourceId && p.value.action === action),
  };
}
