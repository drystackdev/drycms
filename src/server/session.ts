import { verifySession, type SessionPayload } from "../lib/session-token.js";
import { isSessionRevoked } from "./session-blacklist.js";

/**
 * Cookie parsing shared by `handler.ts` (resolves the session once per
 * request, for every route) and `routes/auth.ts` (writes/clears this same
 * cookie). Kept separate from `lib/session-token.ts` - that module only
 * knows how to sign/verify the token string itself, not where it's carried.
 */
export const SESSION_COOKIE_NAME = "drycms_session";

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export async function resolveSession(request: Request, env: Record<string, unknown> = {}): Promise<SessionPayload | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  const session = await verifySession(token);
  if (!session || await isSessionRevoked(token, env)) return null;
  return session;
}
