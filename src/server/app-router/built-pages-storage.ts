import { bufferOf } from "../../storage/util.js";
import { StorageError, type StorageAdapter } from "../../storage/types.js";
import { pagesCacheStorage } from "../config.js";
import { getStorageAdapter } from "../storage-adapters.js";
import type { DryRouteContext } from "../context.js";

/**
 * Raw-HTML object storage for the app-r2 build pipeline
 * (`plans/app-r2.md` mục 12) - deliberately separate from `pages-cache.ts`'s
 * `PageCacheEnvelope` (JSON + version bookkeeping), which keeps serving the
 * CURRENTLY LIVE site unchanged. Both share the same `pagesCacheStorage`
 * root but never the same keys: the envelope cache uses bare
 * `<encoded-path>.json` at the root; everything here lives under `built/`
 * and ends in `.html`, so the two can never collide.
 *
 * Nothing in `page-handler.ts` reads from here yet - see
 * `status/app-r2-build.md` for why that cutover is deliberately not done in
 * the same pass as this module (flipping the live read path before a real
 * page has ever been built through this pipeline would 404 the whole site).
 */

function normalizedPath(pathname: string): string {
  return pathname === "/" ? "__root__" : pathname.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** Stable, pathname-derived key every serve-time read would use - never
 * varies per build, so the read side (once wired) never needs a registry
 * lookup to find it. */
export function liveKeyFor(pathname: string): string {
  return `built/live/${encodeURIComponent(normalizedPath(pathname))}.html`;
}

/** Immutable per-build key (quyết định #7) - `buildId` is caller-supplied
 * (the browser build orchestrator mints one per build call, e.g.
 * `crypto.randomUUID()`), NOT `build-id.ts`'s process-lifetime `buildId()`
 * (a different concept - that one invalidates the OLD envelope cache on
 * every restart; this one gives each individual build its own rollback
 * point, several of which can coexist within one running server). */
export function immutableKeyFor(pathname: string, buildId: string): string {
  return `built/objects/${encodeURIComponent(buildId)}/${encodeURIComponent(normalizedPath(pathname))}.html`;
}

/** Writes `html` to `pathname`'s immutable build key AND copies it onto the
 * stable live key in the same call - the common "build now, go live now"
 * case (no `schedule`). Returns both keys so the caller can record
 * `objectKey` in `_pages` (`pages-registry-types.ts`). For a SCHEDULED
 * build (mục 9), write the immutable object only (skip the live copy) and
 * let cron call `publishImmutableObject` once due. */
export async function writeBuiltPage(
  context: Pick<DryRouteContext, "env">,
  pathname: string,
  buildId: string,
  html: string,
  options: { publishNow: boolean },
): Promise<{ immutableKey: string; liveKey: string | null }> {
  const adapter = getStorageAdapter(pagesCacheStorage, context);
  const immutableKey = immutableKeyFor(pathname, buildId);
  const bytes = Buffer.from(html, "utf8");
  await adapter.write(immutableKey, bytes);
  if (!options.publishNow) return { immutableKey, liveKey: null };
  const liveKey = liveKeyFor(pathname);
  await adapter.write(liveKey, bytes);
  return { immutableKey, liveKey };
}

/** Copies an already-written immutable object onto the live key - the
 * cron-flip half of `schedule` (mục 9) and admin rollback both funnel
 * through this. Not `adapter.copy()` (its contract requires the destination
 * NOT already exist - `types.ts`'s doc comment - wrong for a key that's
 * overwritten every time a page goes live); read-then-write instead, cheap
 * at HTML-document sizes. */
export async function publishImmutableObject(
  context: Pick<DryRouteContext, "env">,
  pathname: string,
  immutableKey: string,
): Promise<string> {
  const adapter = getStorageAdapter(pagesCacheStorage, context);
  const file = await adapter.read(immutableKey);
  const bytes = await bufferOf(file.stream);
  const liveKey = liveKeyFor(pathname);
  await adapter.write(liveKey, bytes);
  return liveKey;
}

/** Reads the live HTML for `pathname`, or `null` on a routine miss - same
 * "never throw for a plain miss" contract `pages-cache.ts`'s
 * `readPageCache` already documents. Not called anywhere in the live
 * request path yet (see this module's doc comment). */
export async function readBuiltPage(context: Pick<DryRouteContext, "env">, pathname: string): Promise<string | null> {
  const adapter: StorageAdapter = getStorageAdapter(pagesCacheStorage, context);
  try {
    const file = await adapter.read(liveKeyFor(pathname));
    return (await bufferOf(file.stream)).toString("utf8");
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") return null;
    throw error;
  }
}

/** Removes both the live key and (if given) the immutable object - the
 * storage half of `_pages`'s "phải dọn row khi xoá" (mục 5); the registry
 * row itself is `pagesRegistry.removePage`'s job, called alongside this by
 * whichever route triggers a page deletion. */
export async function removeBuiltPage(context: Pick<DryRouteContext, "env">, pathname: string): Promise<void> {
  const adapter = getStorageAdapter(pagesCacheStorage, context);
  await adapter.remove(liveKeyFor(pathname)).catch((error: unknown) => {
    if (!(error instanceof StorageError && error.code === "not_found")) throw error;
  });
}
