import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `store/auth.ts` reads `window.__DRY_CONFIG__` and touches `document` at
 * MODULE scope (same as `RichTextField/component-registry.ts` etc. - this
 * codebase's established "browser-only module" shape, no SSR guard), so
 * both have to exist before the dynamic `import()` below runs. No `jsdom`/
 * `happy-dom` in this repo (vitest defaults to the `node` environment) -
 * `document` is stubbed as a real `EventTarget` rather than pulling in a DOM
 * library, since the module under test only ever calls
 * `addEventListener`/reads `visibilityState`/`cookie` on it.
 */
class FakeDocument extends EventTarget {
  cookie = "";
  visibilityState: "visible" | "hidden" = "visible";
}

/** Minimal in-memory stand-in - `slideSession()`'s cross-tab refresh
 * coalescing (`recentlyRefreshedInAnotherTab`) reads/writes `localStorage`,
 * which the `node` test environment doesn't provide any more than it does
 * `document` above. */
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const fakeDocument = new FakeDocument();
const fakeLocalStorage = new FakeLocalStorage();
vi.stubGlobal("window", { __DRY_CONFIG__: { path: "/dry" } });
vi.stubGlobal("document", fakeDocument);
vi.stubGlobal("localStorage", fakeLocalStorage);

const { authState, login, logout } = await import("./auth.js");

const SLIDING_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

function stubFetchOnce(responses: { url: string; ok: boolean; body?: unknown }[]) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const match = responses.find((r) => url.endsWith(r.url));
    if (!match) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(JSON.stringify(match.body ?? {}), { status: match.ok ? 200 : 401 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const USER = { id: 1, name: "Khan", email: "khan@example.com", roles: [], isSuperAdmin: true, permissions: [] };

describe("sliding session refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeDocument.cookie = "";
    fakeDocument.visibilityState = "visible";
    fakeLocalStorage.clear();
    authState.value = { status: "anonymous", user: null };
  });

  it("refreshes the access token on a timer once authenticated, without the caller doing anything", async () => {
    stubFetchOnce([{ url: "/api/auth/login", ok: true, body: { user: USER } }]);
    await login("khan@example.com", "secret");
    expect(authState.value.status).toBe("authenticated");

    fakeDocument.cookie = "drycms_csrf=abc";
    const refreshMock = stubFetchOnce([{ url: "/api/auth/refresh", ok: true, body: { user: USER } }]);

    await vi.advanceTimersByTimeAsync(SLIDING_REFRESH_INTERVAL_MS);

    expect(refreshMock).toHaveBeenCalledWith("/dry/api/auth/refresh", { method: "POST" });
    expect(authState.value.status).toBe("authenticated");
  });

  it("keeps refreshing indefinitely across multiple ticks - the whole point (an open tab never runs out on its own)", async () => {
    stubFetchOnce([{ url: "/api/auth/login", ok: true, body: { user: USER } }]);
    await login("khan@example.com", "secret");
    fakeDocument.cookie = "drycms_csrf=abc";
    const refreshMock = stubFetchOnce([{ url: "/api/auth/refresh", ok: true, body: { user: USER } }]);

    await vi.advanceTimersByTimeAsync(SLIDING_REFRESH_INTERVAL_MS * 3);

    expect(refreshMock).toHaveBeenCalledTimes(3);
    expect(authState.value.status).toBe("authenticated");
  });

  it("drops to anonymous - a real re-login, not a silent mid-session failure - once the refresh token itself is no longer good", async () => {
    stubFetchOnce([{ url: "/api/auth/login", ok: true, body: { user: USER } }]);
    await login("khan@example.com", "secret");
    fakeDocument.cookie = "drycms_csrf=abc";
    stubFetchOnce([{ url: "/api/auth/refresh", ok: false }]);

    await vi.advanceTimersByTimeAsync(SLIDING_REFRESH_INTERVAL_MS);

    expect(authState.value).toEqual({ status: "anonymous", user: null });
  });

  it("stops ticking once logged out - no dangling timer left calling refresh for a signed-out user", async () => {
    stubFetchOnce([{ url: "/api/auth/login", ok: true, body: { user: USER } }]);
    await login("khan@example.com", "secret");
    fakeDocument.cookie = "drycms_csrf=abc";

    stubFetchOnce([{ url: "/api/auth/logout", ok: true }]);
    await logout();
    expect(authState.value.status).toBe("anonymous");

    const refreshMock = stubFetchOnce([{ url: "/api/auth/refresh", ok: true, body: { user: USER } }]);
    await vi.advanceTimersByTimeAsync(SLIDING_REFRESH_INTERVAL_MS * 2);

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("catches up immediately when the tab is foregrounded again, not on whatever throttled tick a backgrounded timer gets", async () => {
    stubFetchOnce([{ url: "/api/auth/login", ok: true, body: { user: USER } }]);
    await login("khan@example.com", "secret");
    fakeDocument.cookie = "drycms_csrf=abc";
    const refreshMock = stubFetchOnce([{ url: "/api/auth/refresh", ok: true, body: { user: USER } }]);

    // No timer advance at all - only a visibility change, simulating a tab
    // that was backgrounded long enough for its timer to have been throttled.
    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
