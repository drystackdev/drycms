import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configBox = vi.hoisted(() => ({ edgeTtl: 60 }));

vi.mock("../config.js", () => ({
  get pagesCacheEdgeTtl() {
    return configBox.edgeTtl;
  },
}));

const { isEdgeCacheable, readEdgeCache, storeEdgeCache } = await import("./edge-cache.js");

/** Stand-in for workerd's `caches.default` - the real one only exists inside
 * a Worker, so the module's own "no Cache API here" fallback is what runs
 * unless a test installs this. */
function installCache() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => store.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      // The real `put` reads the body to completion; doing the same here is
      // what makes "both halves of the stream get pumped" observable.
      store.set(request.url, new Response(await response.text(), response));
    }),
  };
  (globalThis as { caches?: unknown }).caches = { default: cache };
  return { cache, store };
}

const waitUntils: Promise<unknown>[] = [];
const ctx = { waitUntil: (promise: Promise<unknown>) => void waitUntils.push(promise) };

beforeEach(() => {
  configBox.edgeTtl = 60;
  waitUntils.length = 0;
});

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

function pageResponse(html = "<html>page</html>", init: ResponseInit = {}): Response {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" }, ...init });
}

describe("isEdgeCacheable", () => {
  it("accepts an anonymous GET", () => {
    expect(isEdgeCacheable(new Request("https://site.test/about"))).toBe(true);
  });

  it("rejects a non-GET", () => {
    expect(isEdgeCacheable(new Request("https://site.test/about", { method: "POST" }))).toBe(false);
  });

  it("rejects a viewer carrying an admin or VEI cookie", () => {
    const cookies = ["drycms_session=abc", "drycms_vei=abc", "drycms_admin=", "other=1; drycms_vei=abc"];
    for (const cookie of cookies) {
      expect(isEdgeCacheable(new Request("https://site.test/about", { headers: { Cookie: cookie } }))).toBe(false);
    }
  });

  it("ignores an unrelated cookie", () => {
    expect(isEdgeCacheable(new Request("https://site.test/about", { headers: { Cookie: "consent=1" } }))).toBe(true);
  });

  it("is off entirely when edgeTtl is 0", () => {
    configBox.edgeTtl = 0;
    expect(isEdgeCacheable(new Request("https://site.test/about"))).toBe(false);
  });
});

describe("readEdgeCache / storeEdgeCache", () => {
  it("misses (rather than throwing) when there is no Cache API at all", async () => {
    const request = new Request("https://site.test/about");
    expect(await readEdgeCache(request)).toBeNull();
    const response = storeEdgeCache(request, pageResponse(), ctx);
    expect(await response.text()).toBe("<html>page</html>");
    expect(waitUntils).toHaveLength(0);
  });

  it("stores a rendered page and serves the next request from it", async () => {
    installCache();
    const request = new Request("https://site.test/about");

    const first = storeEdgeCache(request, pageResponse(), ctx);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=60, must-revalidate");
    expect(first.headers.get("X-Drycms-Cache")).toBe("MISS");
    // The client's own copy still streams in full even though the cache took one.
    expect(await first.text()).toBe("<html>page</html>");
    await Promise.all(waitUntils);

    const hit = await readEdgeCache(request);
    expect(hit).not.toBeNull();
    expect(hit!.headers.get("X-Drycms-Cache")).toBe("HIT");
    expect(await hit!.text()).toBe("<html>page</html>");
  });

  it("keeps each URL on its own cache entry", async () => {
    const { store } = installCache();
    storeEdgeCache(new Request("https://site.test/a"), pageResponse("<html>a</html>"), ctx);
    storeEdgeCache(new Request("https://site.test/b"), pageResponse("<html>b</html>"), ctx);
    await Promise.all(waitUntils);
    expect(store.size).toBe(2);
    expect(await (await readEdgeCache(new Request("https://site.test/b")))!.text()).toBe("<html>b</html>");
  });

  it("refuses to store anything but a plain 200 HTML/XML document", async () => {
    const { cache } = installCache();
    const request = new Request("https://site.test/about");

    storeEdgeCache(request, pageResponse("<html>404</html>", { status: 404 }), ctx);
    storeEdgeCache(request, new Response("{}", { headers: { "Content-Type": "application/json" } }), ctx);
    storeEdgeCache(request, pageResponse("<html>vei</html>", { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } }), ctx);
    storeEdgeCache(request, pageResponse("<html>login</html>", { headers: { "Content-Type": "text/html", "Set-Cookie": "drycms_vei=x" } }), ctx);

    await Promise.all(waitUntils);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("stores a sitemap (XML) as well as HTML", async () => {
    const { cache } = installCache();
    storeEdgeCache(
      new Request("https://site.test/sitemap.xml"),
      new Response("<urlset/>", { headers: { "Content-Type": "application/xml" } }),
      ctx,
    );
    await Promise.all(waitUntils);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("never lets a cache-write failure break the response", async () => {
    const { cache } = installCache();
    cache.put.mockRejectedValueOnce(new Error("cache unavailable"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = storeEdgeCache(new Request("https://site.test/about"), pageResponse(), ctx);
    await expect(Promise.all(waitUntils)).resolves.toBeDefined();
    expect(await response.text()).toBe("<html>page</html>");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
