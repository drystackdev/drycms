import { signal } from "@preact/signals";
const { path } = window.__DRY_CONFIG__;
import { permissionKeyFor, type PermissionAction } from "../content-types/permissions.js";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  /** A storage id under `.avatar/` (resolve with `resolveImageSrc()` for
   * `<img src>`) or `""` - same "resolved fresh every time, never in the
   * signed session token" treatment `roles` gets below (`routes/auth.ts`'s
   * `resolveClientUser`). */
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

/** Cache-busting nonce for the signed-in user's own avatar image, bumped by
 * `updateProfile()`. `AvatarField`'s upload target is a FIXED path per user
 * (`.avatar/<userId>.webp` - see its own doc comment), so replacing an
 * avatar overwrites the exact URL the sidebar/topbar may already have
 * cached from page load; the storage `GET` route sets `Last-Modified` but no
 * `Cache-Control`, so the browser's heuristic cache can keep serving the old
 * bytes at that URL after a successful save with no visible re-fetch.
 * Same `signal(0)` + "bump on success" shape as `content-types.ts`'s
 * `contentTypesVersion`. */
export const avatarVersion = signal(0);

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

/** Hard ceiling on a single refresh round trip. A refresh that never comes
 * back used to freeze the whole admin silently: `csrf-fetch.ts` awaits this
 * before retrying the 401'd request, and shares that one promise with every
 * other request that 401s, so nothing in the UI ever resolved or errored -
 * just spinners (production, 2026-08-12). Giving up returns `null`, which
 * surfaces the original 401 to the caller instead. */
const REFRESH_REQUEST_TIMEOUT_MS = 15_000;
/** How long to wait for a sibling tab's refresh lock before refreshing
 * without it (see `refreshExpiredSession`). */
const REFRESH_LOCK_WAIT_MS = 12_000;

function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function rotateRefreshToken(): Promise<AuthUser | null> {
  const { signal, done } = timeoutSignal(REFRESH_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${path}/api/auth/refresh`, { method: "POST", signal });
    if (!res.ok) return null;
    const body = await res.json();
    return body.user ?? null;
  } catch {
    // Aborted by the timeout above, or a genuine network failure - either way
    // this refresh didn't happen. Never rethrow: every caller treats `null`
    // as "still signed out", and a throw here would reject the API request
    // that triggered it with a confusing error instead of its own 401.
    return null;
  } finally {
    done();
  }
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
 *
 * Called from two places: `loadSession()` below (once, on mount, if the
 * access token was already expired at page load) and
 * `lib/native/csrf-fetch.ts`'s reactive 401-retry (every other time an
 * in-flight request finds the access token expired mid-session). There is
 * deliberately no separate proactive/periodic caller (e.g. a `setInterval`)
 * - drycms tried that once (2026-08-10) and it raced THIS SAME function
 * every ~10 minutes, since both were rotating the one single-use refresh
 * token independently; that race is exactly the "reuse" full-logout path
 * described above. Reactive-only means an action taken right after the
 * 15-minute access token lapses costs one extra refresh+retry round trip
 * instead of failing outright - acceptable, and far simpler than
 * coordinating two timers.
 */
export async function refreshExpiredSession(): Promise<AuthUser | null> {
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
  // Bounded, because a Web Lock is only released when its holder finishes or
  // its page goes away - and a tab whose refresh wedged (or that the browser
  // froze in the background) does neither. Waiting unbounded there means
  // every 401 in THIS tab hangs behind it with no error, which is how the
  // whole admin appeared to freeze in production (2026-08-12). Falling back
  // to an unlocked rotate after the wait restores only the small cross-tab
  // race this lock exists to close, and only in that already-degraded case.
  const { signal, done } = timeoutSignal(REFRESH_LOCK_WAIT_MS);
  try {
    return await navigator.locks.request(REFRESH_LOCK_NAME, { signal }, rotate);
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== "AbortError") throw error;
    return rotate();
  } finally {
    done();
  }
}

/**
 * The session is gone for good: an API request came back 401 and
 * `refreshExpiredSession()` couldn't rescue it (`lib/native/csrf-fetch.ts`).
 * Flipping to `anonymous` makes `AuthGate` show Sign in; without it every
 * page just sat on its spinner waiting for data that was never going to
 * arrive, with no error anywhere - the admin looked frozen and only a manual
 * reload brought it back (production, 2026-08-12). In-progress entry edits
 * survive this: they're kept in IndexedDB, not in the page.
 *
 * A no-op unless we currently believe we're signed in, so a 401 on a public/
 * pre-login page can't bounce a first-run admin off `needs-setup`.
 */
export function markSessionExpired(): void {
  if (authState.value.status !== "authenticated") return;
  authState.value = { status: "anonymous", user: null };
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
  avatarVersion.value++;
}

export async function logout(): Promise<void> {
  await fetch(`${path}/api/auth/logout`, { method: "POST" }).catch(() => undefined);
  authState.value = { status: "anonymous", user: null };
}
