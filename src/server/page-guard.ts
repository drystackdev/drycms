import { path } from "./config.js";
import { resolveSession, SESSION_COOKIE_NAME } from "./session.js";

// No pages currently need a pre-emptive server-side redirect - every admin
// page's own client-side `AuthGate`/`canAccess` guard is enough. Add a path
// here (like `${path}/key-value` used to be) for a page that needs the
// unauthenticated visitor redirected before it ever receives the SPA shell.
const AUTHENTICATED_PAGES = new Set<string>([]);

/** Protects pages that otherwise fall through to the SPA shell. API routes
 * already have their own authorization path; this prevents an unauthenticated
 * browser from even receiving the protected page shell. */
export async function guardPageRequest(request: Request, env: Record<string, unknown> = {}): Promise<Response | null> {
  const url = new URL(request.url);
  if (!AUTHENTICATED_PAGES.has(url.pathname)) return null;
  if (await resolveSession(request, env)) return null;
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: new URL(`${path}/login`, request.url).toString(),
      "Set-Cookie": `${SESSION_COOKIE_NAME}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    },
  });
  return response;
}
