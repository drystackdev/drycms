import { signSession, verifySessionClaims, type SessionPayload } from "../lib/session-token.js";
import { isAuthSessionValid } from "./auth-security.js";
import { readCookie, readSessionCookie } from "./session.js";

/**
 * The Visual Editing Interface's own cookies (see `plans/vei.md`). Both are
 * `Path=/` - unlike every other cookie here, which is scoped to the admin's
 * own `path` (`routes/auth.ts`'s `sessionCookieHeader`, `csrf.ts`) and so
 * never reaches a public page request at all.
 *
 * `drycms_vei` carries a session token in the same format, signed with the
 * same key, differing only in lifetime (see `VEI_MAX_AGE_SECONDS`). No
 * second token format and no second signing key, and revocation keeps
 * working because verification goes through the same `isAuthSessionValid`
 * server-side record check. It is strictly a read capability: nothing
 * writes through it - every write in this feature happens inside an iframe
 * under the admin path, where the real session cookie and its CSRF pair
 * already apply.
 *
 * `drycms_admin` is a non-`HttpOnly`, valueless hint so the overlay script
 * on a CACHED public page can decide whether to show its button at all
 * without spending a request per anonymous visitor. It grants nothing.
 */
export const VEI_COOKIE_NAME = "drycms_vei";
export const VEI_HINT_COOKIE_NAME = "drycms_admin";

/** Long enough to survive an editing session on the public site, where
 * nothing rotates the admin's own 15-minute access cookie (that only
 * happens from the admin SPA, which isn't open). */
export const VEI_MAX_AGE_SECONDS = 2 * 60 * 60;

export function readVeiCookie(request: Request): string | undefined {
  return readCookie(request, VEI_COOKIE_NAME);
}

/** The signed-in user behind a `drycms_vei` cookie, or `null` for anything
 * that doesn't verify (absent, expired, revoked session record). Mirrors
 * `session.ts`'s `resolveSession` exactly, against the other cookie. */
export async function resolveVeiSession(request: Request, env: Record<string, unknown> = {}): Promise<SessionPayload | null> {
  const token = readVeiCookie(request);
  if (!token) return null;
  const claims = await verifySessionClaims(token);
  if (!claims || !(await isAuthSessionValid(claims.sessionId, claims.id, claims.issuedAt, env))) return null;
  return { id: claims.id, name: claims.name, email: claims.email };
}

/** A VEI token for whoever the request's ADMIN session cookie says it is,
 * or `null` when there's no valid admin session to derive one from. The
 * only place a VEI token is ever created. */
export async function mintVeiToken(request: Request, env: Record<string, unknown> = {}): Promise<string | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  const claims = await verifySessionClaims(token);
  if (!claims || !(await isAuthSessionValid(claims.sessionId, claims.id, claims.issuedAt, env))) return null;
  return signSession(
    { id: claims.id, name: claims.name, email: claims.email },
    { sessionId: claims.sessionId, expiresInMs: VEI_MAX_AGE_SECONDS * 1000 },
  );
}

function cookieAttributes(url: URL, maxAgeSeconds: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${url.protocol === "https:" ? "; Secure" : ""}`;
}

export function veiCookieHeader(url: URL, token: string, maxAgeSeconds: number): string {
  return `${VEI_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(url, maxAgeSeconds)}`;
}

export function clearVeiCookieHeader(url: URL): string {
  return veiCookieHeader(url, "", 0);
}

/** Not `HttpOnly` on purpose - `apps/vei/overlay.ts` reads it from
 * `document.cookie`. Carries no identity, only "someone signed in here". */
export function veiHintCookieHeader(url: URL, maxAgeSeconds: number): string {
  return `${VEI_HINT_COOKIE_NAME}=1; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${url.protocol === "https:" ? "; Secure" : ""}`;
}

export function clearVeiHintCookieHeader(url: URL): string {
  return `${VEI_HINT_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`;
}
