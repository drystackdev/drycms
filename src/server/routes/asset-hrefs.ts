import type { DryRouteHandler } from "../context.js";
import { errorResponse, jsonResponse } from "../route-helpers.js";
import { path } from "../config.js";
import { ensurePreactRuntimeAsset } from "../app-router/built-pages-storage.js";
import { GLOBALS_CSS_HREF, HYDRATE_BUILT_HREF, HYDRATE_ENTRY_HREF, VEI_OVERLAY_HREF } from "../app-router/assets.js";

/**
 * Exposes `assets.ts`'s built hrefs to the ADMIN's own browser bundle
 * (`page-build.ts`/`PageBuild.tsx`, mục 7) - server-only route, deliberately
 * NOT something client code imports `assets.ts` directly for: that module
 * re-exports from `resolve-asset-href.ts`, which imports `node:fs` at
 * module scope - a static `export {...} from` loads the whole module graph
 * regardless of which binding is actually used, so ANY client-side import
 * of `assets.ts` breaks in a real browser build (confirmed live,
 * `status/app-r2-build.md` - the exact bug `build-document.ts` hit and was
 * fixed for). This route runs server-side only (Node, or Workers with
 * `nodejs_compat` - `render.ts` already imports the same module today), so
 * it's a safe place to read the real values and hand them over as plain
 * JSON instead.
 *
 * `preactRuntimeHref` is NOT one of `assets.ts`'s Vite-manifest hrefs (see
 * `build-preact-runtime-bundle.ts` for why that file can't be a normal Vite
 * build asset) - it's a `built-assets` storage read instead, built on
 * first request (`ensurePreactRuntimeAsset`).
 */
export const GET: DryRouteHandler = async (context) => {
  try {
    const preactRuntimePath = await ensurePreactRuntimeAsset(context);
    return jsonResponse({
      globalsCssHref: GLOBALS_CSS_HREF,
      hydrateEntryHref: HYDRATE_ENTRY_HREF,
      veiOverlayHref: VEI_OVERLAY_HREF,
      preactRuntimeHref: `${path}/api/built-assets/${preactRuntimePath}`,
      hydrateBuiltHref: HYDRATE_BUILT_HREF,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
