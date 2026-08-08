import { setReplayLog } from "../content-types/dry-reader-client.js";
import { setCurrentParams } from "../content-types/params-reader-client.js";
import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import { installMediaSrcHook } from "../server/app-router/media-src-hook.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import type { RouteMatch } from "../server/app-router/match.js";
import { setAdminPath } from "../storage/admin-path.js";
import { HYDRATED_EVENT } from "./hydrated-event.js";

/**
 * Client hydration bootstrap for the app-r2 BUILD pipeline (`plans/app-r2.md`
 * mục 7) - the counterpart to `hydrate-client.ts` for a page that only
 * exists as browser-compiled source in `pagesSourceStorage`, never a
 * Vite-known SSR route. `hydrate-client.ts` finds its page/layout modules
 * via `import.meta.glob`+`discoverRoutes()` (compile-time, Vite's own
 * module graph); this one has no such graph to consult - the page/layout
 * URLs it needs are embedded directly in the built HTML itself
 * (`#dry-hydrate-manifest`, written by `page-build.ts`'s `buildAssets`),
 * and it `import()`s them as plain, already-compiled ESM - no eval, no
 * Vite, nothing this file needs to know about `pagesSourceStorage` at all.
 *
 * `hydrate` is deliberately NOT a normal static import (a direct
 * `preact-iso/hydrate` import, what `hydrate-client.ts` uses, or an
 * earlier attempt at a separate `preact-runtime.ts` rollup input - found
 * live, `bun run build:worker`: either way, THIS file's own bundled code
 * would end up sharing the ADMIN app's own deduped Preact chunk, a
 * SEPARATE module instance from whatever the dynamically-imported page/
 * layout modules below use). Those modules import their `h`/`Fragment`/
 * hooks from `manifest.preactRuntimeUrl` (`page-build.ts` rewrites their
 * bare `"preact"`/`"preact/hooks"` specifiers to point there) - hooks state
 * only works correctly when every component in the tree, AND whatever
 * calls `hydrate()` to walk it, share ONE Preact module instance, so
 * `hydrate` itself is `import()`ed from that exact same URL below instead:
 * the browser's own ES module cache (one module instance per absolute URL)
 * is what actually guarantees the two line up, not anything Vite/Rollup
 * does at build time.
 */

interface HydrateManifest {
  entryUrl: string;
  /** Root-to-leaf, same convention `SourceRouteMatch.layoutPaths` uses. */
  layoutUrls: string[];
  /** `built-assets`-storage URL for `preact-runtime.js`
   * (`build-preact-runtime-bundle.ts`) - see this file's own doc comment
   * for why `hydrate` has to come from THIS SAME URL rather than a normal
   * import. */
  preactRuntimeUrl: string;
}

function seedAdminPath(): void {
  const element = document.getElementById("dry-vei-config");
  if (!element?.textContent) return;
  try {
    const { path } = JSON.parse(element.textContent) as { path?: string };
    if (typeof path === "string") setAdminPath(path);
  } catch {
    // Falls back to `admin-path.ts`'s own default.
  }
}
seedAdminPath();

installMediaSrcHook();

async function importDefault(url: string): Promise<(props: never) => unknown> {
  const mod = (await import(/* @vite-ignore */ url)) as { default?: (props: never) => unknown };
  if (typeof mod.default !== "function") {
    throw new Error(`[drycms] hydrate-built: "${url}" has no default export function.`);
  }
  return mod.default;
}

async function main(): Promise<void> {
  try {
    const manifestElement = document.getElementById("dry-hydrate-manifest");
    // No manifest = a page mục 7's build step decided has no interactive
    // island (or one that predates this feature) - nothing to hydrate,
    // same "static page, no islands" case `hydrate-client.ts`'s own doc
    // comment already accepts for a plain `404.tsx`.
    if (!manifestElement?.textContent) return;
    const manifest = JSON.parse(manifestElement.textContent) as HydrateManifest;

    const logElement = document.getElementById("dry-replay-data");
    setReplayLog(logElement?.textContent ? decodeCallLog(logElement.textContent) : []);

    const paramsElement = document.getElementById("dry-hydrate-params");
    const params = (paramsElement?.textContent ? JSON.parse(paramsElement.textContent) : {}) as Record<string, string | string[]>;
    setCurrentParams(params);

    const match: RouteMatch = {
      page: async () => ({ default: await importDefault(manifest.entryUrl) }),
      layouts: manifest.layoutUrls.map((url) => async () => ({ default: await importDefault(url) })),
      params,
    };

    const vnode = await resolveMatchToVNode(match);
    const { hydrate } = (await import(/* @vite-ignore */ manifest.preactRuntimeUrl)) as {
      hydrate: (vnode: unknown) => void;
    };
    // No target argument - same as `hydrate-client.ts`'s identical call:
    // `preact-iso/hydrate` finds its own mount point via the `isodata`
    // marker's `parentNode` (`build-document.ts`'s `ISODATA_MARKER`, always
    // present - `buildDocument` emits it unconditionally on every page).
    hydrate(vnode as never);
  } finally {
    (window as { dryHydrated?: boolean }).dryHydrated = true;
    window.dispatchEvent(new Event(HYDRATED_EVENT));
  }
}

void main();
