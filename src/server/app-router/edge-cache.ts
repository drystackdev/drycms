import { pagesCacheEdgeTtl } from "../config.js";
import { readCookie, SESSION_COOKIE_NAME } from "../session.js";
import { ADMIN_HINT_COOKIE_NAME } from "../admin-hint-cookie.js";

/**
 * Cloudflare's edge cache in front of the whole page pipeline - the layer
 * `app-router/pages-cache.ts` can't be: that one still costs a storage read
 * plus a D1 version check per view, and it only starts helping AFTER the
 * Worker has already been invoked, resolved its adapters and bootstrapped
 * its schema. A hit here answers from the colo that received the request,
 * touching neither D1 nor R2 (see `status/worker-request-cost.md` for the
 * per-request cost breakdown this exists to cut).
 *
 * Correctness rests on two rules, both enforced below:
 *
 * - Only fully anonymous `GET`s participate. Any request carrying an admin
 *   session or the signed-in hint cookie skips the cache in BOTH directions,
 *   so an editor never reads (or seeds) a shared copy.
 * - Freshness is time-based, not version-based, because eviction can't be
 *   coordinated: Cloudflare's cache is per-colo, so a purge issued while
 *   handling one request would only ever clear the colo that ran it. An
 *   anonymous visitor therefore sees an edit at most `pagesCache.edgeTtl`
 *   seconds late; a signed-in editor sees it immediately.
 *
 * Node runs none of this (`caches` is a workerd global, and `entry-node.ts`
 * never calls in) - and Cloudflare disables the Cache API on `*.workers.dev`
 * subdomains, where every function here degrades to a miss rather than
 * failing. A custom domain/route is required for it to actually cache.
 */

/** The minimal slice of workerd's `caches.default` this module uses - same
 * hand-rolled-shape precedent as `engine/d1-driver.ts`'s `D1Database`,
 * rather than depending on `@cloudflare/workers-types` for one interface.
 * (DOM's own `caches` is a `CacheStorage`, which has no `default`.) */
interface WorkerCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** Marks where a response came from, so a deploy can be verified with a
 * plain `curl -I` instead of guessing from timings. */
const CACHE_STATUS_HEADER = "X-Drycms-Cache";

/** A cookie whose presence means "this viewer is not anonymous". The admin
 * session cookie is scoped to the admin `path` and so never reaches a public
 * page at all (see `admin-hint-cookie.ts`) - checked anyway rather than
 * relying on that scoping to stay true. */
const PRIVATE_COOKIES = [SESSION_COOKIE_NAME, ADMIN_HINT_COOKIE_NAME];

function cacheStorage(): WorkerCache | null {
  const store = (globalThis as { caches?: { default?: unknown } }).caches;
  const candidate = store?.default as WorkerCache | undefined;
  return candidate && typeof candidate.match === "function" ? candidate : null;
}

/** Whether this request may take part in the edge cache at all - the same
 * answer is needed before reading and before storing, so callers compute it
 * once and pass it to both.
 *
 * `ttlSeconds` (`plans/app-r2.md` mục 14): omitted = exact original
 * behavior, gated on `pagesCacheEdgeTtl` (every existing caller -
 * `entry-worker.ts` wrapping the whole page pipeline - is unaffected by
 * this parameter's addition). Passed explicitly by a caller with its OWN
 * TTL notion (a future sitemap-specific call site) so "pages cache is
 * disabled" doesn't also silently disable an unrelated resource's caching -
 * turning off `pagesCacheEdgeTtl` was never meant to reach `sitemap.xml`. */
export function isEdgeCacheable(request: Request, ttlSeconds?: number): boolean {
  const ttl = ttlSeconds ?? pagesCacheEdgeTtl;
  if (ttl <= 0) return false;
  if (request.method !== "GET") return false;
  return !PRIVATE_COOKIES.some((name) => readCookie(request, name) !== undefined);
}

/** The cached response for this request, or `null` on any kind of miss
 * (including "no Cache API here at all"). */
export async function readEdgeCache(request: Request): Promise<Response | null> {
  const cache = cacheStorage();
  if (!cache) return null;
  const hit = await cache.match(request);
  if (!hit) return null;
  const response = new Response(hit.body, hit);
  response.headers.set(CACHE_STATUS_HEADER, "HIT");
  return response;
}

/**
 * Returns the response to send, having scheduled a copy of it into the edge
 * cache when it's eligible. The `Cache-Control` written here is what gives
 * the stored copy its lifetime: `s-maxage` for the shared cache, `max-age=0`
 * so a browser still revalidates rather than pinning the page for a user who
 * hits reload after an edit.
 *
 * Only a plain `200` HTML/XML document is stored. A `Set-Cookie` response is
 * excluded outright - `cache.put` rejects those, and storing one would leak
 * one viewer's cookie to the next.
 *
 * `ttlSeconds` (mục 14): omitted = exact original behavior
 * (`pagesCacheEdgeTtl`, unconditionally). A future sitemap-specific caller
 * passes its own value (capped by `_pages.publish_at`'s next-due time, so a
 * scheduled page doesn't stay missing from a cached sitemap past its
 * publish moment) instead of inheriting whatever the page cache's TTL
 * happens to be.
 */
export function storeEdgeCache(request: Request, response: Response, ctx: WaitUntil, ttlSeconds?: number): Response {
  const cache = cacheStorage();
  if (!cache || response.status !== 200 || response.headers.has("Set-Cookie")) return response;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("xml")) return response;
  if (response.headers.get("Cache-Control")?.includes("no-store")) return response;

  const stored = new Response(response.body, response);
  stored.headers.set("Cache-Control", `public, max-age=0, s-maxage=${ttlSeconds ?? pagesCacheEdgeTtl}, must-revalidate`);
  stored.headers.set(CACHE_STATUS_HEADER, "MISS");
  // `put` consumes its own clone's body while the returned one streams to the
  // client - both halves have to be pumped, so the write is held open with
  // `waitUntil` rather than left floating past the response.
  const copy = stored.clone();
  ctx.waitUntil(cache.put(request, copy).catch((error: unknown) => {
    console.error("[drycms] failed to store the edge-cache entry:", error);
  }));
  return stored;
}
