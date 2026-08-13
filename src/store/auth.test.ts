import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `store/auth.ts` reads `window.__DRY_CONFIG__` and touches `document` at
 * MODULE scope (same as `RichTextField/component-registry.ts` etc. - this
 * codebase's established "browser-only module" shape, no SSR guard), so
 * both have to exist before the dynamic `import()` below runs. No `jsdom`/
 * `happy-dom` in this repo (vitest defaults to the `node` environment) -
 * `document` is stubbed as a real `EventTarget` rather than pulling in a DOM
 * library, since the module under test only ever reads `document.cookie`.
 */
class FakeDocument extends EventTarget {
  cookie = "";
}

/** Minimal in-memory stand-in - `refreshExpiredSession()`'s cross-tab
 * refresh coalescing (`recentlyRefreshedInAnotherTab`) reads/writes
 * `localStorage`, which the `node` test environment doesn't provide any
 * more than it does `document` above. */
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

/** Real browsers serialize same-name `navigator.locks.request()` calls
 * across tabs; Bun's `navigator` global has no `locks` at all (`"locks" in
 * navigator` is `false`), so `refreshExpiredSession()` falls back to running
 * unlocked - fine for the single-caller tests below, but it would hide the
 * exact race `refreshExpiredSession()` exists to close. This stand-in only
 * needs to chain callbacks in call order, same as the real exclusive lock -
 * plus the `{ signal }` overload and its abort-while-queued rejection, which
 * is how the caller stops waiting on a lock nobody is releasing. */
interface FakeLockOptions {
  signal?: AbortSignal;
}
class FakeLockManager {
  private queue: Promise<unknown> = Promise.resolve();
  reset(): void {
    this.queue = Promise.resolve();
  }
  /** Blocks every later `request()` behind a lock that is never released -
   * a tab that wedged mid-refresh, or one the browser froze while holding
   * it. */
  blockForever(): void {
    this.queue = new Promise(() => {});
  }
  request<T>(
    _name: string,
    optionsOrCallback: FakeLockOptions | (() => Promise<T>),
    maybeCallback?: () => Promise<T>,
  ): Promise<T> {
    const callback = (typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback)!;
    const signal = typeof optionsOrCallback === "function" ? undefined : optionsOrCallback.signal;
    let started = false;
    const run = this.queue.then(() => {
      started = true;
      return callback();
    });
    this.queue = run.then(() => undefined, () => undefined);
    if (!signal) return run;
    // Aborting only counts while still queued - once the callback is running,
    // the lock is held and the signal is ignored (same as the real API).
    return Promise.race([
      run,
      new Promise<T>((_resolve, reject) => {
        const onAbort = () => {
          if (!started) reject(Object.assign(new Error("Lock request aborted."), { name: "AbortError" }));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  }
}

const fakeDocument = new FakeDocument();
const fakeLocalStorage = new FakeLocalStorage();
const fakeLockManager = new FakeLockManager();
vi.stubGlobal("window", { __DRY_CONFIG__: { path: "/dry" } });
vi.stubGlobal("document", fakeDocument);
vi.stubGlobal("localStorage", fakeLocalStorage);
vi.stubGlobal("navigator", { locks: fakeLockManager });

const { authState, loadSession, login, logout, refreshExpiredSession } = await import("./auth.js");

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

/**
 * There is deliberately no proactive/periodic refresh in this module -
 * drycms tried a `setInterval`-based sliding refresh once (2026-08-10) and
 * it raced `lib/native/csrf-fetch.ts`'s own independent refresh trigger
 * every ~10 minutes, both rotating the one single-use refresh token; the
 * loser looked like a replayed token and the server revoked every session
 * (`revokeAllAuthSessions(..., "reuse")`) - a surprise full logout. Refresh
 * is reactive-only now: `loadSession()` on mount, and `csrf-fetch.ts`'s
 * 401-retry mid-session, both funneled through the one coordinated
 * `refreshExpiredSession()` below so two callers can never race each other.
 */
describe("session refresh", () => {
  beforeEach(() => {
    fakeDocument.cookie = "";
    fakeLocalStorage.clear();
    fakeLockManager.reset();
    authState.value = { status: "anonymous", user: null };
  });

  it("loadSession() transparently refreshes an already-expired access token on mount, using the still-good refresh cookie", async () => {
    fakeDocument.cookie = "drycms_csrf=abc";
    stubFetchOnce([
      { url: "/api/auth/session", ok: true, body: { hasAnyUser: true, user: null } },
      { url: "/api/auth/refresh", ok: true, body: { user: USER } },
    ]);

    await loadSession();

    expect(authState.value).toEqual({ status: "authenticated", user: USER, needsInitialPublish: false });
  });

  it("loadSession() falls back to anonymous - a real re-login - once the refresh token itself is no longer good", async () => {
    fakeDocument.cookie = "drycms_csrf=abc";
    stubFetchOnce([
      { url: "/api/auth/session", ok: true, body: { hasAnyUser: true, user: null } },
      { url: "/api/auth/refresh", ok: false },
    ]);

    await loadSession();

    expect(authState.value).toEqual({ status: "anonymous", user: null, needsInitialPublish: false });
  });

  it("refreshExpiredSession() skips the network entirely when there's no CSRF cookie (this browser was never signed in)", async () => {
    const fetchMock = stubFetchOnce([]);

    const user = await refreshExpiredSession();

    expect(user).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("two overlapping refreshExpiredSession() calls (e.g. two tabs, or two 401-triggered retries at once) consume the one-shot refresh token only once", async () => {
    fakeDocument.cookie = "drycms_csrf=abc";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/auth/refresh")) return new Response(JSON.stringify({ user: USER }), { status: 200 });
      if (url.endsWith("/api/auth/session")) return new Response(JSON.stringify({ hasAnyUser: true, user: USER }), { status: 200 });
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    // Not awaited individually before the other starts - the same overlap
    // two tabs (or two in-flight requests both hitting a 401) can produce.
    // Without the cross-tab lock, both would present the same refresh token
    // to POST /api/auth/refresh; the second would then look like a replayed
    // token on its next use and the server would revoke every session.
    const [first, second] = await Promise.all([refreshExpiredSession(), refreshExpiredSession()]);

    expect(calls.filter((url) => url.endsWith("/api/auth/refresh"))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith("/api/auth/session"))).toHaveLength(1);
    expect(first).toEqual(USER);
    expect(second).toEqual(USER);
  });

  it("refreshes unlocked rather than hanging when a sibling tab's lock is never released", async () => {
    // The production freeze on 2026-08-12: one wedged refresh kept the Web
    // Lock, so every 401-triggered retry queued behind it forever -
    // `csrf-fetch.ts` awaits this before retrying, and shares that one
    // promise across requests, so the whole admin sat on spinners with no
    // error until the page was reloaded.
    fakeDocument.cookie = "drycms_csrf=abc";
    fakeLockManager.blockForever();
    const fetchMock = stubFetchOnce([{ url: "/api/auth/refresh", ok: true, body: { user: USER } }]);
    vi.useFakeTimers();
    try {
      const pending = refreshExpiredSession();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toEqual(USER);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a refresh request that never comes back, instead of blocking every 401'd request behind it", async () => {
    fakeDocument.cookie = "drycms_csrf=abc";
    vi.stubGlobal("fetch", vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      // A request that hangs until its own abort signal fires - exactly what
      // an unresponsive `/api/auth/refresh` looked like from the browser.
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    vi.useFakeTimers();
    try {
      const pending = refreshExpiredSession();
      await vi.advanceTimersByTimeAsync(20_000);
      // `null`, not a rejection: the caller's own 401 is what should surface.
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("login()/logout() still set authState directly, unaffected by the refresh path", async () => {
    stubFetchOnce([{ url: "/api/auth/login", ok: true, body: { user: USER } }]);
    await login("khan@example.com", "secret");
    expect(authState.value).toEqual({ status: "authenticated", user: USER, needsInitialPublish: false });

    stubFetchOnce([{ url: "/api/auth/logout", ok: true }]);
    await logout();
    expect(authState.value).toEqual({ status: "anonymous", user: null, needsInitialPublish: false });
  });
});
