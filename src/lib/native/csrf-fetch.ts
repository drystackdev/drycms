const { path } = window.__DRY_CONFIG__;
import { markSessionExpired, refreshExpiredSession } from "../../store/auth.js";

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

/** `routes/git.ts`'s `proxy()` relays GitHub/GitLab's own 401/403 verbatim
 * (`error: "git_unauthorized"`) when the tenant's stored token is bad - a
 * completely different failure than OUR session expiring, which just
 * happens to reuse the same HTTP status. Treating it as a session signal
 * forced a real, valid session through the refresh dance (occasionally
 * losing the race against the single-use refresh token's reuse-detection,
 * per `store/auth.ts`'s own doc comment) and logged the admin out every
 * time a git operation ran against an expired PAT - confirmed live on
 * `dev.drystack.dev` 2026-08-19, `e2e-org/e2e-repo`'s stored token. */
async function isGitUpstreamAuthError(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { error?: string };
    return body?.error === "git_unauthorized";
  } catch {
    return false;
  }
}

/** Shares `store/auth.ts`'s own refresh path (Web Locks + cross-tab
 * coalescing) rather than posting to `/api/auth/refresh` directly - that
 * function is also called on mount by `loadSession()`, so a second,
 * uncoordinated caller here could race it to rotate the same single-use
 * refresh token and trigger the server's reuse-detection full logout. */
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

    if (response.status === 401 && !isAuthEndpoint(url.pathname) && !(await isGitUpstreamAuthError(response))) {
      if (await refreshOnce()) {
        const retryHeaders = new Headers(securedRequest.headers);
        const retryCsrf = csrfToken();
        if (retryCsrf && MUTATING_METHODS.has(method)) retryHeaders.set("X-CSRF-Token", retryCsrf);
        response = await originalFetch(new Request(securedRequest, { headers: retryHeaders }));
      } else {
        // The refresh couldn't rescue this one - say so instead of handing
        // the 401 back to a caller that will silently swallow it and leave
        // its spinner up forever (`markSessionExpired`'s doc comment).
        markSessionExpired();
      }
    }
    return response;
  };
  window.fetch = csrfFetch as typeof window.fetch;
  // No periodic refresh timer here on purpose - refresh is reactive only
  // (`store/auth.ts`'s `refreshExpiredSession` explains why two independent
  // rotators of one single-use token is the bug, not the fix).
}
