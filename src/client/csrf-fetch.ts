import { path } from "virtual:drycms/config";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let installed = false;
let refreshing: Promise<boolean> | undefined;

function csrfToken(): string | undefined {
  const prefix = "drycms_csrf=";
  const part = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : undefined;
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
    if (url.origin !== window.location.origin || !url.pathname.startsWith(`${path}/api/`) || !MUTATING_METHODS.has(method)) {
      return originalFetch(input, init);
    }
    const token = csrfToken();
    if (!token) return originalFetch(input, init);
    const headers = new Headers(request.headers);
    headers.set("X-CSRF-Token", token);
    const securedRequest = new Request(request, { headers });
    let response = await originalFetch(securedRequest.clone());
    const isAuthEndpoint = url.pathname.endsWith("/api/auth/login") ||
      url.pathname.endsWith("/api/auth/register-first-admin") ||
      url.pathname.endsWith("/api/auth/refresh") ||
      url.pathname.endsWith("/api/auth/logout");
    if (response.status !== 401 || isAuthEndpoint) return response;

    refreshing ??= (async () => {
      const refreshHeaders = new Headers();
      const refreshCsrf = csrfToken();
      if (refreshCsrf) refreshHeaders.set("X-CSRF-Token", refreshCsrf);
      const refreshResponse = await originalFetch(`${path}/api/auth/refresh`, {
        method: "POST",
        headers: refreshHeaders,
        credentials: "same-origin",
      });
      return refreshResponse.ok;
    })().finally(() => {
      refreshing = undefined;
    });
    if (await refreshing) {
      const retryHeaders = new Headers(securedRequest.headers);
      const retryCsrf = csrfToken();
      if (retryCsrf) retryHeaders.set("X-CSRF-Token", retryCsrf);
      response = await originalFetch(new Request(securedRequest, { headers: retryHeaders }));
    }
    return response;
  };
  window.fetch = csrfFetch as typeof window.fetch;
}
