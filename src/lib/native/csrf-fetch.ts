const { path } = window.__DRY_CONFIG__;
import { refreshExpiredSession } from "../../store/auth.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let installed = false;
let refreshing: Promise<boolean> | undefined;

function csrfToken(): string | undefined {
  const prefix = "drycms_csrf=";
  const part = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : undefined;
}

function isAuthEndpoint(pathname: string): boolean {
  return pathname.startsWith(`${path}/api/auth/`);
}

/** Shares `store/auth.ts`'s own refresh path (Web Locks + cross-tab
 * coalescing) rather than posting to `/api/auth/refresh` directly - the
 * proactive sliding refresh over there already runs on its own timer, so a
 * second, uncoordinated caller here would periodically race it to rotate the
 * same single-use refresh token and trigger the server's reuse-detection
 * full logout. */
async function refreshSession(): Promise<boolean> {
  return (await refreshExpiredSession()) !== null;
}

function refreshOnce(): Promise<boolean> {
  refreshing ??= refreshSession().catch(() => false).finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

/** Adds the double-submit CSRF header to same-origin API mutations once for
 * every browser fetch used by the SPA. External requests remain untouched. */
export function installCsrfFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  const csrfFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    init ??= {};
    const request = new Request(input, init);
    const method = request.method.toUpperCase();
    const url = new URL(request.url, window.location.href);
    const isApiRequest = url.origin === window.location.origin && url.pathname.startsWith(`${path}/api/`);
    if (!isApiRequest) {
      return originalFetch(input, init);
    }
    const headers = new Headers(request.headers);
    const token = csrfToken();
    if (token && MUTATING_METHODS.has(method)) headers.set("X-CSRF-Token", token);
    const securedRequest = new Request(request, { headers });
    let response = await originalFetch(securedRequest.clone());

    if (response.status === 401 && !isAuthEndpoint(url.pathname) && await refreshOnce()) {
      const retryHeaders = new Headers(securedRequest.headers);
      const retryCsrf = csrfToken();
      if (retryCsrf && MUTATING_METHODS.has(method)) retryHeaders.set("X-CSRF-Token", retryCsrf);
      response = await originalFetch(new Request(securedRequest, { headers: retryHeaders }));
    }
    return response;
  };
  window.fetch = csrfFetch as typeof window.fetch;
  // Proactive sliding refresh lives in `store/auth.ts` (its own timer, with
  // cross-tab coordination) - this module only reacts to an actual 401.
}
