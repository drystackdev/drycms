import { effect, signal } from "@preact/signals";
const { path } = window.__DRY_CONFIG__;
import { permissionKeyFor, type PermissionAction } from "../content-types/permissions.js";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  /** `data:image/webp;base64,...` or `""` - same "resolved fresh every
   * time, never in the signed session token" treatment `roles` gets below
   * (`routes/auth.ts`'s `resolveClientUser`). */
  avatar: string;
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

const REFRESH_LOCK_NAME = "drycms-session-refresh";
const LAST_REFRESH_STORAGE_KEY = "drycms_session_last_refresh";
const REFRESH_COALESCE_WINDOW_MS = 60 * 1000;

function recentlyRefreshedInAnotherTab(): boolean {
  const last = Number(localStorage.getItem(LAST_REFRESH_STORAGE_KEY) ?? "0");
  return Number.isFinite(last) && Date.now() - last < REFRESH_COALESCE_WINDOW_MS;
}

async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch(`${path}/api/auth/session`);
  if (!res.ok) return null;
  const body = await res.json();
  return body.user ?? null;
}

async function rotateRefreshToken(): Promise<AuthUser | null> {
  const res = await fetch(`${path}/api/auth/refresh`, { method: "POST" });
  if (!res.ok) return null;
  const body = await res.json();
  return body.user ?? null;
}

/**
 * The refresh-token cookie is shared (same-origin, same browser) across
 * every open tab. `rotateAuthSession()` (`server/auth-security.ts`) treats
 * that token as single-use, and its single-use check is only atomic on the
 * D1/SQLite backends - Cloudflare KV has no compare-and-delete primitive, so
 * two tabs presenting the SAME token close together can both "succeed" there
 * before either sees the other's write. The loser's token then looks
 * identical to a stolen/replayed one on its next use, so the server can't
 * tell them apart and revokes every session the user has
 * (`revokeAllAuthSessions(..., "reuse")`) - a surprise full logout. The Web
 * Locks API makes the rotation itself mutually exclusive ACROSS tabs (not
 * just within one tab's own event loop), and `recentlyRefreshedInAnotherTab()`
 * is only checked AFTER the lock is held - checking before acquiring it
 * can't rule out a sibling tab acquiring and finishing first while this tab
 * was still waiting. A tab that loses the race this way reuses the
 * sibling's outcome via a plain `GET /api/auth/session` (cheap, doesn't
 * consume a token) instead of presenting its now-stale refresh token.
 * Locks are undefined in older browsers (pre-Safari 15.4); falling back to
 * running inline there just restores the tiny pre-existing race window
 * rather than breaking refresh entirely.
 */
async function refreshExpiredSession(): Promise<AuthUser | null> {
  // The refresh token is HttpOnly. The CSRF cookie is only readable by the
  // browser when a session was previously issued, so anonymous app loads do
  // not make a pointless refresh request.
  if (typeof document === "undefined" || !document.cookie.split(";").some((part) => part.trim().startsWith("drycms_csrf="))) {
    return null;
  }
  const rotate = async (): Promise<AuthUser | null> => {
    if (recentlyRefreshedInAnotherTab()) return fetchCurrentUser();
    const user = await rotateRefreshToken();
    if (user) localStorage.setItem(LAST_REFRESH_STORAGE_KEY, String(Date.now()));
    return user;
  };
  if (typeof navigator === "undefined" || !("locks" in navigator)) return rotate();
  return navigator.locks.request(REFRESH_LOCK_NAME, rotate);
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

/**
 * Sliding refresh - without this, the SPA silently drops the admin's
 * session mid-use (found live, reported by the user: "sau 1 thời gian thì
 * tự động mất đăng nhập"): `lib/session-token.ts`'s access-token cookie
 * (`drycms_session`) only lives 15 minutes, and nothing else in the app
 * calls `/api/auth/refresh` again after `loadSession()`'s own one-shot call
 * at mount. The 30-day refresh cookie was always sitting there valid and
 * ready to extend the session - reloading the tab already proved that (it
 * calls `refreshExpiredSession()` too, see `loadSession()`) - just nothing
 * called it again while the tab stayed open, so every action taken more
 * than 15 minutes into a session started failing with no obvious recovery
 * short of a reload the user had no reason to think would help.
 *
 * `INTERVAL_MS` is comfortably under the 15-minute access-token lifetime
 * (not equal to it) so a slow refresh round trip, or a delayed timer tick,
 * still lands before the current token would have expired. Each successful
 * refresh rotates BOTH cookies (`routes/auth.ts`'s `withSessionCookies`) - a
 * fresh 30-day refresh token every time - so an open tab's session never
 * actually runs out on its own; only `logout()`, a revoked/reused refresh
 * token, or a genuinely idle browser (backgrounded/closed long enough that
 * even the 30-day refresh cookie lapses) ends it.
 */
const SLIDING_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

let slidingRefreshTimer: ReturnType<typeof setInterval> | undefined;

function stopSlidingRefresh(): void {
  if (slidingRefreshTimer === undefined) return;
  clearInterval(slidingRefreshTimer);
  slidingRefreshTimer = undefined;
}

async function slideSession(): Promise<void> {
  const refreshedUser = await refreshExpiredSession();
  // A failed refresh here means the refresh token itself is no longer good
  // (revoked, reused, or its own 30-day life ran out) - a real "please sign
  // in again", not the silent mid-session drop this effect exists to
  // prevent. Only reachable while `status` was already "authenticated", so
  // this doesn't fight `loadSession()`'s own first-load resolution.
  authState.value = refreshedUser ? { status: "authenticated", user: refreshedUser } : { status: "anonymous", user: null };
}

// A tab backgrounded past the access-token's own lifetime has its timers
// throttled/paused by the browser (found live: a `setInterval` alone still
// left a session dead on the very next action after switching back to a
// long-backgrounded tab) - catching up the instant the tab is foregrounded
// again closes that gap instead of waiting for whatever tick the browser
// eventually allows. Registered once at module scope, not inside the effect
// below - it only fires the check while `authState` is actually
// "authenticated", so it doesn't need adding/removing on every sign-in/out.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && authState.value.status === "authenticated") void slideSession();
});

effect(() => {
  if (authState.value.status !== "authenticated") {
    stopSlidingRefresh();
    return;
  }
  if (slidingRefreshTimer !== undefined) return;
  slidingRefreshTimer = setInterval(() => void slideSession(), SLIDING_REFRESH_INTERVAL_MS);
});

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

/** Self-service edit of the signed-in user's own `name`/`email`/`avatar`/
 * password -
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
  avatar: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${path}/api/auth/update-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, avatar, currentPassword, newPassword }),
  });
  await assertOk(res, "Failed to update profile.");
  const body = await res.json();
  authState.value = { status: "authenticated", user: body.user };
}

export async function logout(): Promise<void> {
  await fetch(`${path}/api/auth/logout`, { method: "POST" }).catch(() => undefined);
  authState.value = { status: "anonymous", user: null };
}
