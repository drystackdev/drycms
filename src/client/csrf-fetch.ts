import { path } from "virtual:drycms/config";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SESSION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
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

async function refreshSession(originalFetch: typeof window.fetch): Promise<boolean> {
  const refreshCsrf = csrfToken();
  // The refresh token is HttpOnly, so the readable CSRF cookie is the safe
  // client-side signal that this browser still has an authenticated session.
  if (!refreshCsrf) return false;
  const refreshHeaders = new Headers({ "X-CSRF-Token": refreshCsrf });
  const refreshResponse = await originalFetch(`${path}/api/auth/refresh`, {
    method: "POST",
    headers: refreshHeaders,
    credentials: "same-origin",
  });
  return refreshResponse.ok;
}

function refreshOnce(originalFetch: typeof window.fetch): Promise<boolean> {
  refreshing ??= refreshSession(originalFetch).catch(() => false).finally(() => {
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

    if (response.status === 401 && !isAuthEndpoint(url.pathname) && await refreshOnce(originalFetch)) {
      const retryHeaders = new Headers(securedRequest.headers);
      const retryCsrf = csrfToken();
      if (retryCsrf && MUTATING_METHODS.has(method)) retryHeaders.set("X-CSRF-Token", retryCsrf);
      response = await originalFetch(new Request(securedRequest, { headers: retryHeaders }));
    }
    return response;
  };
  window.fetch = csrfFetch as typeof window.fetch;

  // A session token lasts 15 minutes. Refresh earlier to keep an idle tab
  // signed in; the CSRF-cookie check prevents anonymous refresh calls.
  window.setInterval(() => {
    void refreshOnce(originalFetch);
  }, SESSION_REFRESH_INTERVAL_MS);
}
