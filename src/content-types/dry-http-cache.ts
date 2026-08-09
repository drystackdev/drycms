import { deleteCacheEntriesByPrefix, getCacheEntry, setCacheEntry } from "../lib/idb-cache.js";

/**
 * IndexedDB cache in front of `POST ${adminPath}/api/dry-http`, for the page
 * editor's LIVE PREVIEW only (`PageEditor.tsx`'s `refreshPreview`, which
 * re-renders the whole page on a debounce after every edit - each render
 * re-running every `dry()` call the page makes, against content that
 * typically hasn't changed at all between two keystrokes).
 *
 * Deliberately cache-first with a TTL and NO revalidation: within `ttlMs` a
 * hit means zero network, which is the entire point (a preview shouldn't
 * pay N round trips per keystroke). The trade is real - content edited in
 * the CMS right now can stay invisible to the preview until the TTL lapses,
 * so the preview toolbar's "Refresh data" (`clearDryHttpCache`) exists as
 * the manual escape hatch.
 *
 * NOT used by any path that publishes: `handleBuildCurrent`/`handleBuildAll`
 * (PageEditor) and `PageBuild.tsx` all leave `ttlMs` unset, so they fetch
 * fresh exactly as before - built HTML on `built/live/*` never carries cached
 * data, and the `X-Dry-Resource-Version` those builds record into
 * `_page_deps` (`plans/app-r2.md` mục 5) stays the true current version
 * rather than whatever was cached.
 */

const KEY_PREFIX = "dry-http:";

export interface DryHttpResponse {
  /** Raw `encodeCallLog([entry])` text - kept encoded rather than decoded so
   * the cached value round-trips through `structuredClone` (IndexedDB's own
   * storage algorithm) unchanged; `decodeCallLog` revives `Date`s and other
   * non-JSON values that would otherwise have to survive that trip. */
  text: string;
  /** `X-Dry-Resource` - "" when the call touched no content type. */
  resource: string;
  /** `X-Dry-Resource-Version` at fetch time. */
  version: number;
}

/**
 * JSON with object keys sorted at every depth, so two wire requests that
 * differ only in property order (`{ page, name }` vs `{ name, page }` - real
 * possibility, `callServer` and `fetchSeoDefaults` build their bodies
 * independently) map to ONE cache key instead of two. Arrays keep their
 * order: `include: ["a","b"]` and `["b","a"]` are the same query, but not
 * worth reordering here - a duplicate key only costs one extra fetch,
 * whereas reordering a caller's array that DOES carry meaning would be a
 * silently wrong hit.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Exported for tests - the cache is only as correct as this key is
 * discriminating (two different queries sharing a key would serve each
 * other's data). */
export function dryHttpCacheKey(endpoint: string, body: unknown): string {
  return `${KEY_PREFIX}${endpoint}:${stableStringify(body)}`;
}

async function postDryHttp(endpoint: string, body: unknown): Promise<DryHttpResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    text: await response.text(),
    resource: response.headers.get("X-Dry-Resource") ?? "",
    version: Number(response.headers.get("X-Dry-Resource-Version") ?? "0"),
  };
}

/**
 * `ttlMs` undefined/0 (every publishing caller) is a plain fetch: nothing is
 * read from the cache and - just as important - nothing is written to it
 * either, so a "Build all" can't seed entries that a later preview would
 * then serve from.
 */
export async function fetchDryHttp(endpoint: string, body: unknown, ttlMs?: number): Promise<DryHttpResponse> {
  if (!ttlMs) return postDryHttp(endpoint, body);

  const key = dryHttpCacheKey(endpoint, body);
  const cached = await getCacheEntry<DryHttpResponse>(key);
  if (cached && Date.now() - cached.cachedAt < ttlMs) return cached.data;

  const fresh = await postDryHttp(endpoint, body);
  await setCacheEntry(key, fresh, fresh.version);
  return fresh;
}

/** "Refresh data" in the preview toolbar - drops every cached `dry()`
 * response so the next preview build refetches. Shares `idb-cache.ts`'s
 * store with `useFetch()`'s own entries, hence the prefixed delete: the
 * admin UI's cached list/detail data is a separate concern and must survive
 * this. */
export async function clearDryHttpCache(): Promise<void> {
  await deleteCacheEntriesByPrefix(KEY_PREFIX);
}
