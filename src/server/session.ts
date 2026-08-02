import { verifySessionClaims, type SessionPayload } from "../lib/session-token.js";
import { isAuthSessionValid } from "./auth-security.js";

/**
 * Cookie parsing shared by `handler.ts` (resolves the session once per
 * request, for every route) and `routes/auth.ts` (writes/clears this same
 * cookie). Kept separate from `lib/session-token.ts` - that module only
 * knows how to sign/verify the token string itself, not where it's carried.
 */
export const SESSION_COOKIE_NAME = "drycms_session";
export const REFRESH_COOKIE_NAME = "drycms_refresh";

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === SESSION_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === REFRESH_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export async function resolveSession(request: Request, env: Record<string, unknown> = {}): Promise<SessionPayload | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  const claims = await verifySessionClaims(token);
  if (!claims || !(await isAuthSessionValid(claims.sessionId, claims.id, claims.issuedAt, env))) return null;
  return { id: claims.id, name: claims.name, email: claims.email };
}
