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
 * `page-handler.ts` reads `readBuiltPage` on every prod request and
 * `publishImmutableObject` on a live-key miss (lazy `schedule` promotion) -
 * see `status/app-r2-build.md` for the cutover history.
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
 * `schedule` flip (mục 9, now done lazily at request time by
 * `page-handler.ts` rather than a cron sweep - see `status/app-r2-build.md`)
 * and admin rollback both funnel through this. Not `adapter.copy()` (its
 * contract requires the destination NOT already exist - `types.ts`'s doc
 * comment - wrong for a key that's overwritten every time a page goes live);
 * read-then-write instead, cheap at HTML-document sizes. Returns the HTML
 * alongside the live key so a request-time caller (`page-handler.ts`) can
 * serve this same response without a redundant `readBuiltPage` round trip. */
export async function publishImmutableObject(
  context: Pick<DryRouteContext, "env">,
  pathname: string,
  immutableKey: string,
): Promise<{ liveKey: string; html: string }> {
  const adapter = getStorageAdapter(pagesCacheStorage, context);
  const file = await adapter.read(immutableKey);
  const bytes = await bufferOf(file.stream);
  const liveKey = liveKeyFor(pathname);
  await adapter.write(liveKey, bytes);
  return { liveKey, html: bytes.toString("utf8") };
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

/**
 * Compiled JS ASSET storage (mục 7's `page.js`/`layout.js`) - keyed by
 * SOURCE path, not by pathname: a shared `layout.tsx` compiles to the same
 * bytes regardless of which page references it, so one upload serves every
 * page that imports it (unlike `liveKeyFor`, which is per-PAGE). No
 * immutable/live split here - a JS asset has no `schedule` concept of its
 * own (the HTML that references it does); overwriting in place on every
 * build is correct - a visitor loading it always wants whatever the source
 * currently compiles to. Public, unauthenticated read
 * (`routes/built-assets.ts`) - same treatment `GLOBALS_CSS_HREF`/favicon
 * already get, nothing here is more sensitive than site source that was
 * ALREADY compiled client-side to produce the page a visitor is looking at.
 */
/** `jsPath` is already `.js`-suffixed (the CALLER's job to convert from a
 * `.tsx`/`.ts` source path - `page-build.ts`'s `toJsAssetPath` - so this
 * function, and the public read route that shares it, never have to guess
 * whether a given slug still needs converting). */
export function liveAssetKeyFor(jsPath: string): string {
  return `built/live-assets/${jsPath}`;
}

export async function writeBuiltAsset(context: Pick<DryRouteContext, "env">, jsPath: string, jsSource: string): Promise<string> {
  const adapter = getStorageAdapter(pagesCacheStorage, context);
  const key = liveAssetKeyFor(jsPath);
  await adapter.write(key, Buffer.from(jsSource, "utf8"));
  return key;
}

export async function readBuiltAsset(context: Pick<DryRouteContext, "env">, jsPath: string): Promise<string | null> {
  const adapter = getStorageAdapter(pagesCacheStorage, context);
  try {
    const file = await adapter.read(liveAssetKeyFor(jsPath));
    return (await bufferOf(file.stream)).toString("utf8");
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") return null;
    throw error;
  }
}

/** Fixed key, not derived from any page - one shared Preact runtime, not a
 * per-page asset (`build-preact-runtime-bundle.ts`'s doc comment has the
 * full story on why this can't be a normal Vite build asset). `__dry/`
 * keeps it out of the way of a real page's own asset keys, which are bare
 * filenames straight off `sourceByPath` (e.g. `Greeting.js`) - never
 * nested, so this can never collide with one. */
const PREACT_RUNTIME_ASSET_PATH = "__dry/preact-runtime.js";

/**
 * Builds `preact-runtime.js` into `built-assets` storage the first time
 * anything asks for it, then leaves it alone - `stat` (not a full `read`)
 * is enough to tell whether that's already happened, same "build once,
 * reuse forever" contract `build-component-bundle.ts`'s
 * `ensureSharedPreactBundle` already established for its own Preact vendor
 * bundle. Its content never changes per-project, so the SAME already-built
 * copy is correct for every page a build ever produces - no cache
 * invalidation of any kind needed.
 *
 * Gated on the NODE runtime specifically, not `import.meta.env.DEV` (tried
 * first, wrong signal - found live under `wrangler dev`: that always runs
 * the compiled PRODUCTION worker bundle, so `import.meta.env.DEV` is
 * `false` there too, meaning this could never self-bootstrap under
 * Workers at all, not even in local testing). The real constraint is
 * narrower than dev-vs-prod: `buildPreactRuntimeBundle`'s nested
 * `vite.build()` needs live Vite/esbuild tooling, which only Node can run
 * (dev OR prod) - workerd never can, dev OR deployed, `nodejs_compat` or
 * not. Same `process.versions.node` check `types-cache.ts`'s
 * `writeGeneratedDryTypes` already uses to tell the two apart. A Workers
 * deployment can still SERVE an already-built copy fine
 * (`routes/built-assets.ts` is a plain storage read, runtime-agnostic) -
 * it just needs a Node run against its storage backend (`bun run dev`
 * pointed at the same storage, or a Node deployment of this same project)
 * to have produced one first.
 */
/** Returns the `jsPath` (not the storage key) - `routes/built-assets.ts`
 * takes the same shape `page-build.ts`'s own `jsAssets` do, so the caller
 * can build a public URL as `${path}/api/built-assets/${jsPath}` either
 * way. */
export async function ensurePreactRuntimeAsset(context: Pick<DryRouteContext, "env">): Promise<string> {
  const adapter = getStorageAdapter(pagesCacheStorage, context);
  if (await adapter.stat(liveAssetKeyFor(PREACT_RUNTIME_ASSET_PATH))) return PREACT_RUNTIME_ASSET_PATH;
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new StorageError(
      "unsupported",
      "The Preact runtime bundle hasn't been built yet - run a Node instance of this project (e.g. `bun run dev`) against this storage backend once before using the Workers build.",
    );
  }
  const { buildPreactRuntimeBundle } = await import("../../apps/build-preact-runtime-bundle.js");
  const code = await buildPreactRuntimeBundle();
  await writeBuiltAsset(context, PREACT_RUNTIME_ASSET_PATH, code);
  return PREACT_RUNTIME_ASSET_PATH;
}
