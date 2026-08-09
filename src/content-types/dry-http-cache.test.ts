import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheStore = new Map<string, { key: string; data: unknown; version: number; cachedAt: number }>();

vi.mock("../lib/idb-cache.js", () => ({
  getCacheEntry: vi.fn(async (key: string) => cacheStore.get(key)),
  setCacheEntry: vi.fn(async (key: string, data: unknown, version: number) => {
    cacheStore.set(key, { key, data, version, cachedAt: Date.now() });
  }),
  deleteCacheEntriesByPrefix: vi.fn(async (prefix: string) => {
    for (const key of [...cacheStore.keys()]) if (key.startsWith(prefix)) cacheStore.delete(key);
  }),
}));

const { clearDryHttpCache, dryHttpCacheKey, fetchDryHttp } = await import("./dry-http-cache.js");

const ENDPOINT = "/dry/api/dry-http";
const BODY = { kind: "singleton", name: "homepage", method: "get" };

function stubFetch(text = `[{"result":{"id":1}}]`, version = "7") {
  const fetchMock = vi.fn(async () =>
    new Response(text, {
      status: 200,
      headers: { "X-Dry-Resource": "homepage", "X-Dry-Resource-Version": version },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchDryHttp", () => {
  beforeEach(() => {
    cacheStore.clear();
    vi.unstubAllGlobals();
  });

  it("never reads OR writes the cache without a TTL - the publishing build path", async () => {
    const fetchMock = stubFetch();
    await fetchDryHttp(ENDPOINT, BODY);
    await fetchDryHttp(ENDPOINT, BODY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Nothing cached, so a later preview can't be served data this build fetched.
    expect(cacheStore.size).toBe(0);
  });

  it("returns the response body and both resource headers", async () => {
    stubFetch(`[{"result":null}]`, "42");
    const response = await fetchDryHttp(ENDPOINT, BODY);
    expect(response).toEqual({ text: `[{"result":null}]`, resource: "homepage", version: 42 });
  });

  it("serves a second identical call from the cache, with no network at all", async () => {
    const fetchMock = stubFetch();
    const first = await fetchDryHttp(ENDPOINT, BODY, 60_000);
    const second = await fetchDryHttp(ENDPOINT, BODY, 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("refetches once the entry is older than the TTL", async () => {
    const fetchMock = stubFetch();
    await fetchDryHttp(ENDPOINT, BODY, 60_000);
    for (const entry of cacheStore.values()) entry.cachedAt -= 61_000;
    await fetchDryHttp(ENDPOINT, BODY, 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keys different queries separately", async () => {
    const fetchMock = stubFetch();
    await fetchDryHttp(ENDPOINT, { kind: "collection", name: "blog", method: "list", page: 0 }, 60_000);
    await fetchDryHttp(ENDPOINT, { kind: "collection", name: "blog", method: "list", page: 1 }, 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a body that differs only in key order as the same query", async () => {
    const fetchMock = stubFetch();
    await fetchDryHttp(ENDPOINT, { kind: "singleton", name: "homepage", method: "get" }, 60_000);
    await fetchDryHttp(ENDPOINT, { method: "get", name: "homepage", kind: "singleton" }, 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed response instead of caching it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(fetchDryHttp(ENDPOINT, BODY, 60_000)).rejects.toThrow("HTTP 500");
    expect(cacheStore.size).toBe(0);
  });
});

describe("clearDryHttpCache", () => {
  it("drops only its own namespace, leaving useFetch()'s shared-store entries alone", async () => {
    stubFetch();
    await fetchDryHttp(ENDPOINT, BODY, 60_000);
    cacheStore.set("entries:blog:list:0::asc::", { key: "entries:blog:list:0::asc::", data: {}, version: 1, cachedAt: Date.now() });

    await clearDryHttpCache();

    expect(cacheStore.has(dryHttpCacheKey(ENDPOINT, BODY))).toBe(false);
    expect(cacheStore.has("entries:blog:list:0::asc::")).toBe(true);
  });
});
