import { path as adminPath } from "./config.js";
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

function redirect(request: Request, to: string, cookie: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(to, request.url).toString(), "Set-Cookie": cookie, "Cache-Control": "no-store" },
  });
}

export async function handleVeiRoute(request: Request, env: Record<string, unknown> = {}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ENTER_PATH && url.pathname !== EXIT_PATH) return null;
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!isTopLevelNavigation(request)) return new Response("Forbidden", { status: 403 });

  const to = safeReturnTo(url.searchParams.get("to"));
  if (url.pathname === EXIT_PATH) return redirect(request, to, clearVeiCookieHeader(url));

  const token = await mintVeiToken(request, env);
  // No admin session to derive edit rights from - send them through the
  // normal login, same destination `page-guard.ts` uses for a protected
  // admin page.
  if (!token) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL(`${adminPath}/login`, request.url).toString(), "Cache-Control": "no-store" },
    });
  }
  return redirect(request, to, veiCookieHeader(url, token, VEI_MAX_AGE_SECONDS));
}
