import { path } from "./config.js";

export const CSRF_COOKIE_NAME = "drycms_csrf";
export const CSRF_HEADER_NAME = "X-CSRF-Token";

function readCookie(request: Request): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === CSRF_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function createCsrfToken(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

export function csrfCookieHeader(context: { url: URL }, token: string): string {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${path}; SameSite=Lax${context.url.protocol === "https:" ? "; Secure" : ""}`;
}

export function clearCsrfCookieHeader(context: { url: URL }): string {
  return `${CSRF_COOKIE_NAME}=; Path=${path}; SameSite=Lax; Max-Age=0${context.url.protocol === "https:" ? "; Secure" : ""}`;
}

export function requiresCsrf(request: Request, segment: string, slug?: string): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return false;
  // `mcp` authenticates with a bearer token (`status/mcp-server.md`), never
  // the session cookie the double-submit CSRF check protects - an external
  // MCP client has no CSRF cookie to send, and CSRF isn't a meaningful
  // attack against a request an attacker's page can't get the victim's
  // browser to attach ambient credentials to in the first place.
  if (segment === "mcp") return false;
  // `oauth`'s `register`/`token` are server-to-server (DCR clients and code
  // exchanges carry no session cookie, so no CSRF cookie to send either) -
  // same reasoning as `mcp` above. `consent`/`consent-info` ARE ordinary
  // cookie-authenticated browser requests though (see `routes/oauth.ts`'s
  // own doc comment on the confused-deputy risk that gate closes) and must
  // keep the double-submit check; `authorize` is a GET, already outside this
  // function's method filter above.
  if (segment === "oauth") return slug !== "register" && slug !== "token";
  // A read despite being POST (the query itself is the request body) -
  // `routes/dry-http.ts`'s own doc comment: published-only, gated by
  // per-type `view`/`setting` permission, never a state change. CSRF
  // protects against a forged STATE CHANGE riding a victim's ambient
  // credentials; there's none to forge here, and (unlike every other
  // segment) this one is legitimately called from Page Builder's `srcdoc`
  // preview iframes, which can't read the admin-path-scoped CSRF cookie -
  // same "no meaningful CSRF target" reasoning `mcp`/`oauth` above already
  // get, for a different reason.
  if (segment === "dry-http") return false;
  if (segment !== "auth") return true;
  return slug !== "login";
}

export function hasValidCsrf(request: Request): boolean {
  const cookie = readCookie(request);
  const header = request.headers.get(CSRF_HEADER_NAME);
  return !!cookie && !!header && constantTimeEqual(cookie, header);
}
