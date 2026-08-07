import { resolveAccess } from "../content-types/access.js";
import { VEI_RESOURCE_ID } from "../content-types/permissions.js";
import { verifySessionClaims, type SessionPayload } from "../lib/session-token.js";
import { getContentAdapters } from "./content-adapters.js";
import { path as adminPath } from "./config.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf.js";
import { handleApiRequest } from "./handler.js";
import { readCookie, SESSION_COOKIE_NAME } from "./session.js";
import { clearVeiCookieHeader, mintVeiToken, veiCookieHeader, VEI_MAX_AGE_SECONDS } from "./vei-session.js";

/**
 * The two page-level routes that turn the Visual Editing Interface on and
 * off (`plans/vei.md`). Deliberately NOT under `${path}/api/` and
 * deliberately `GET`: the overlay lives on a public page, where the CSRF
 * cookie - scoped to the admin path like every other cookie here - is
 * neither readable nor sendable, so the double-submit check every API
 * mutation requires is impossible to satisfy from there. A top-level
 * navigation is the one shape that works, and `isTopLevelNavigation` below
 * is what keeps it from being forgeable anyway.
 *
 * `null` = not one of these routes; caller carries on as before.
 */
const ENTER_PATH = `${adminPath}/vei/enter`;
const EXIT_PATH = `${adminPath}/vei/exit`;

/**
 * Only a real browser navigation gets to flip edit mode - not an `<img>`,
 * `fetch`, or a link from another site. `Sec-Fetch-*` is what makes that
 * decidable server-side, and a browser won't let script forge either
 * header. Absent headers mean a non-browser client (curl, a test); those
 * are allowed through since the whole check is about what a browser can be
 * tricked into doing on a logged-in user's behalf.
 */
function isTopLevelNavigation(request: Request): boolean {
  const dest = request.headers.get("Sec-Fetch-Dest");
  const site = request.headers.get("Sec-Fetch-Site");
  if (dest !== null && dest !== "document") return false;
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  return true;
}

/** Never redirect off-origin or into the admin app - `to` arrives on the
 * query string, so it's caller-controlled input. A protocol-relative
 * `//evil.test` is the case a plain `startsWith("/")` misses. */
function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw === adminPath || raw.startsWith(`${adminPath}/`)) return "/";
  return raw;
}

function redirect(request: Request, to: string, cookies: string[]): Response {
  const headers = new Headers({ Location: new URL(to, request.url).toString(), "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * `mintVeiToken` derives from the admin's own 15-minute access cookie, which
 * nothing rotates while browsing the public site (only the admin SPA's
 * `csrf-fetch.ts` does that, and it isn't open) - so it routinely expires out
 * from under a visitor mid-browse even though their 30-day refresh cookie is
 * still perfectly good. Rather than bouncing straight to `/login` for that
 * alone, this replays the exact rotation `POST /api/auth/refresh`
 * (`routes/auth.ts`) already does, server-side, off this request's own
 * cookies - the top-level navigation `handleVeiRoute` already requires IS the
 * trust boundary that check exists for, so satisfying its CSRF double-submit
 * from a value this same request already carries isn't a new exposure.
 */
async function refreshedVeiToken(
  request: Request,
  env: Record<string, unknown>,
): Promise<{ token: string; sessionCookies: string[] } | null> {
  const cookieHeader = request.headers.get("Cookie");
  const csrfValue = readCookie(request, CSRF_COOKIE_NAME);
  if (!cookieHeader || !csrfValue) return null;

  const refreshResponse = await handleApiRequest(
    new Request(new URL(`${adminPath}/api/auth/refresh`, request.url), {
      method: "POST",
      headers: { Cookie: cookieHeader, [CSRF_HEADER_NAME]: csrfValue },
    }),
    env,
  );
  if (!refreshResponse.ok) return null;

  const sessionCookies =
    (refreshResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const newSessionCookie = sessionCookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!newSessionCookie) return null;

  // `mintVeiToken` only needs the fresh session cookie to derive from - not
  // the rest of this request's headers/cookies.
  const refreshedRequest = new Request(request.url, {
    headers: { Cookie: newSessionCookie.split(";", 1)[0]! },
  });
  const token = await mintVeiToken(refreshedRequest, env);
  return token ? { token, sessionCookies } : null;
}

/** Whether `session`'s user holds the `system-vei` permission (see
 * `permissions.ts`'s `VEI_RESOURCE_ID` doc comment) - the real server-side
 * gate for entering edit mode. `routes/auth.ts` also keeps the public
 * `drycms_admin` hint cookie in sync with the same check so the overlay
 * button never offers itself to someone who'd just get a 403 here, but that
 * cookie is client-readable/forgeable, so this is the check that actually
 * matters. */
async function hasVeiAccess(session: SessionPayload, request: Request, env: Record<string, unknown>): Promise<boolean> {
  const { schema, entries } = getContentAdapters({ request, url: new URL(request.url), params: {}, env, session });
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccess(entries, allTypes, session);
  return access?.can(VEI_RESOURCE_ID, "setting") === true;
}

export async function handleVeiRoute(request: Request, env: Record<string, unknown> = {}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ENTER_PATH && url.pathname !== EXIT_PATH) return null;
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!isTopLevelNavigation(request)) return new Response("Forbidden", { status: 403 });

  const to = safeReturnTo(url.searchParams.get("to"));
  if (url.pathname === EXIT_PATH) return redirect(request, to, [clearVeiCookieHeader(url)]);

  let token = await mintVeiToken(request, env);
  let sessionCookies: string[] = [];
  if (!token) {
    const refreshed = await refreshedVeiToken(request, env);
    if (refreshed) {
      token = refreshed.token;
      sessionCookies = refreshed.sessionCookies;
    }
  }
  // No admin session to derive edit rights from, even after trying to
  // refresh - send them through the normal login, same destination
  // `page-guard.ts` uses for a protected admin page.
  if (!token) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL(`${adminPath}/login`, request.url).toString(), "Cache-Control": "no-store" },
    });
  }

  // `token` is a freshly-signed VEI session token either way above - decoding
  // it back (signature/expiry only, no session-store round trip) is cheaper
  // than threading the admin session through both branches above separately.
  const claims = await verifySessionClaims(token);
  const session: SessionPayload | null = claims ? { id: claims.id, name: claims.name, email: claims.email } : null;
  if (!session || !(await hasVeiAccess(session, request, env))) {
    return new Response("Forbidden", { status: 403 });
  }

  return redirect(request, to, [...sessionCookies, veiCookieHeader(url, token, VEI_MAX_AGE_SECONDS)]);
}
