import { signal } from "@preact/signals";
const { path } = window.__DRY_CONFIG__;
import { permissionKeyFor, type PermissionAction } from "../content-types/permissions.js";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  /** Display names of the roles assigned to this user - resolved fresh by
   * the server on every auth response (`routes/auth.ts`'s
   * `resolveRoleLabels`), never cached in the session token itself. Read-only
   * here; `pages/Profile.tsx` shows it, actual role assignment stays an
   * admin-only action through `pages/RoleEditor.tsx`. */
  roles: string[];
  isSuperAdmin: boolean;
  permissions: string[];
}

export type AuthStatus = "loading" | "needs-setup" | "anonymous" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

export class AuthApiError extends Error {
  /** Field name -> message, set only for a 422 validation failure (e.g.
   * `update-profile`'s name/email/unique-email checks) - same shape
   * `entries-http-api.ts`'s `ContentEntriesApiError` carries. */
  fieldErrors?: Record<string, string>;

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Drives `routers/App.tsx`'s `AuthGate`: `loadSession()` is called once on
 * app mount and decides which of the 3 pre-authenticated states to show
 * (`"needs-setup"` - no `user` row exists yet, the first-run Register Super
 * Admin page; `"anonymous"` - Sign in; `"authenticated"` - the real app).
 * A signal (like `store/dashboard.ts`/`store/content-types.ts`) rather than
 * component state, since `AuthGate` sits ABOVE `DryLayout`/`<Router>` and
 * `DryLayout`'s own "Sign out" action needs to flip it back too.
 */
export const authState = signal<AuthState>({ status: "loading", user: null });

/** UI hint only. Every mutation is still authorized again by the server. */
export function canAccess(resourceId: string, action: PermissionAction): boolean {
  const user = authState.value.user;
  return !!user && (user.isSuperAdmin || user.permissions.includes(permissionKeyFor(resourceId, action)));
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const body = await readJson(res);
  throw new AuthApiError(typeof body.message === "string" ? body.message : fallback, body.fieldErrors);
}

async function refreshExpiredSession(): Promise<AuthUser | null> {
  // The refresh token is HttpOnly. The CSRF cookie is only readable by the
  // browser when a session was previously issued, so anonymous app loads do
  // not make a pointless refresh request.
  if (typeof document === "undefined" || !document.cookie.split(";").some((part) => part.trim().startsWith("drycms_csrf="))) {
    return null;
  }
  const res = await fetch(`${path}/api/auth/refresh`, { method: "POST" });
  if (!res.ok) return null;
  const body = await res.json();
  return body.user ?? null;
}

/** Reads `GET /api/auth/session` and sets `authState` accordingly - the one
 * call that decides which of the 3 gate states to show. Called once on app
 * mount (`AuthGate`) and again after `logout()`. */
export async function loadSession(): Promise<void> {
  authState.value = { status: "loading", user: authState.value.user };
  try {
    const res = await fetch(`${path}/api/auth/session`);
    await assertOk(res, "Failed to load session.");
    const body = await res.json();
    if (!body.hasAnyUser) {
      authState.value = { status: "needs-setup", user: null };
    } else if (body.user) {
      authState.value = { status: "authenticated", user: body.user };
    } else {
      const refreshedUser = await refreshExpiredSession();
      authState.value = refreshedUser
        ? { status: "authenticated", user: refreshedUser }
        : { status: "anonymous", user: null };
    }
  } catch {
    // A failed session check degrades to "anonymous" (show Sign in) rather
    // than getting stuck on the loading spinner forever - Sign in's own
    // submit will surface a real error if the server is genuinely down.
    authState.value = { status: "anonymous", user: null };
  }
}

export async function registerFirstAdmin(name: string, email: string, password: string, bootstrapToken: string): Promise<void> {
  const res = await fetch(`${path}/api/auth/register-first-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DryCMS-Bootstrap-Token": bootstrapToken },
    body: JSON.stringify({ name, email, password }),
  });
  await assertOk(res, "Failed to create the Super Admin account.");
  const body = await res.json();
  authState.value = { status: "authenticated", user: body.user };
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${path}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await assertOk(res, "Failed to sign in.");
  const body = await res.json();
  authState.value = { status: "authenticated", user: body.user };
}

/** Self-service edit of the signed-in user's own `name`/`email`/password -
 * `currentPassword`/`newPassword` both empty means "keep the current
 * password" (same "leave blank" contract as `PasswordChangeField`); the
 * server requires BOTH together otherwise (`routes/auth.ts` rejects a
 * `newPassword` submitted without `currentPassword`, and verifies
 * `currentPassword` against the stored hash before accepting the change).
 * Refreshes `authState.user` (and the session cookie server-side) with the
 * saved values, so the sidebar/topbar reflect a rename immediately instead
 * of only after the next login. */
export async function updateProfile(
  name: string,
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${path}/api/auth/update-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, currentPassword, newPassword }),
  });
  await assertOk(res, "Failed to update profile.");
  const body = await res.json();
  authState.value = { status: "authenticated", user: body.user };
}

export async function logout(): Promise<void> {
  await fetch(`${path}/api/auth/logout`, { method: "POST" }).catch(() => undefined);
  authState.value = { status: "anonymous", user: null };
}
