import hydrate from "preact-iso/hydrate";
import { setReplayLog } from "../content-types/dry-reader-client.js";
import { setCurrentParams } from "../content-types/params-reader-client.js";
import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import { matchRoute } from "../server/app-router/match.js";
import { installMediaSrcHook } from "../server/app-router/media-src-hook.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import { discoverRoutes } from "../server/app-router/route-tree.js";
import type { RouteMatch } from "../server/app-router/match.js";
import { setAdminPath } from "../storage/admin-path.js";
import { HYDRATED_EVENT } from "./hydrated-event.js";

/**
 * `resolveImageSrc` (through `media-src-hook.ts` below) needs the admin base
 * path, and `admin-path.ts` reads it from `window.__DRY_CONFIG__` - which
 * only the ADMIN app injects (`server/client-config.ts`), never a public
 * page. Without this, a project whose `dry.config.ts` sets `path` to
 * anything but the default would resolve every `src` against `/dry` here
 * while the server resolved it correctly, i.e. a hydration mismatch that
 * only shows up on a re-render. `#dry-vei-config` carries the real value on
 * every page, cached and anonymous ones included (see `render.ts`'s
 * `veiConfigScript`), and this module script runs after the document is
 * parsed, so the element is always there by now.
 */
function seedAdminPath(): void {
  const element = document.getElementById("dry-vei-config");
  if (!element?.textContent) return;
  try {
    const { path } = JSON.parse(element.textContent) as { path?: string };
    if (typeof path === "string") setAdminPath(path);
  } catch {
    // Falls back to `admin-path.ts`'s own default - the same thing that
    // happened before this existed.
  }
}
seedAdminPath();

// The same hook `render.ts` installs server-side, so a `src` this bundle
// re-renders resolves identically to the one already in the served HTML
// (`media-src-hook.ts`). Installed at module scope, before `main()` builds
// any vnode.
installMediaSrcHook();

/**
 * Resolves this page's `RouteMatch` for hydration - 2 sources, checked in
 * order:
 *
 * 1. `#dry-dev-hydrate-manifest` (`render.ts`'s `RenderPageOptions.
 *    devHydrateManifest`, only ever present for a dev request rendered
 *    through `page-handler.ts`'s `devPagesSource` branch): the server
 *    already resolved this exact request against `pagesSourceStorage`
 *    (`.dry/pages-source`) - re-running `discoverRoutes()` client-side
 *    would resolve against the WRONG source (the compile-time
 *    `src/apps/pages` glob, which no longer holds dev's live pages - see
 *    `route-tree.ts`'s `DevPagesSource` doc comment), so this branch
 *    `import()`s the server-given URLs directly instead of matching a
 *    route tree at all. Also carries `params` directly (the server already
 *    resolved them) rather than re-deriving them from a route match that
 *    doesn't exist client-side for this path.
 * 2. Otherwise (prod, or a dev request that wasn't `devPagesSource`-backed):
 *    the original behavior, matching `window.location.pathname` against
 *    `discoverRoutes()`'s glob-based tree (`src/apps/pages`, real for prod).
 */
async function resolveClientMatch(): Promise<RouteMatch | null> {
  const manifestElement = document.getElementById("dry-dev-hydrate-manifest");
  if (manifestElement?.textContent) {
    const manifest = JSON.parse(manifestElement.textContent) as {
      entryUrl: string;
      layoutUrls: string[];
      params: Record<string, string | string[]>;
    };
    return {
      page: () => import(/* @vite-ignore */ manifest.entryUrl),
      layouts: manifest.layoutUrls.map((url) => () => import(/* @vite-ignore */ url)),
      params: manifest.params,
    };
  }
  const routeTree = await discoverRoutes();
  return matchRoute(routeTree.root, window.location.pathname);
}

/**
 * Client bootstrap for `src/apps/pages/**` (`plans/app-router.md`'s Giai
 * đoạn 2) - loaded via `render.ts`'s `<script type="module">` on every App
 * Router page (MPA - 1 fresh module instance per page load, no client
 * router). `route-tree.ts`/`match.ts` are pure (`import.meta.glob` is the
 * only Vite-specific bit, which works in a client bundle exactly like it
 * does server-side - same precedent as `RichtextComponents.tsx`), so they're
 * imported straight from `src/server/app-router/` rather than duplicated.
 *
 * Re-runs the SAME `page.tsx`/`layout.tsx` code path the server already
 * ran, but with `dry()` (injected by `app-router-plugin.ts`'s
 * `consumer === "client"` branch) replaying the SSR run's already-fetched
 * data instead of hitting a DB that doesn't exist in the browser - see
 * `dry-reader-client.ts`. The resulting vnode tree is structurally
 * identical to what `render.ts` rendered, so `hydrate()` attaches to the
 * existing DOM instead of re-creating it.
 */
async function main(): Promise<void> {
  // `finally` so this fires even on the early return below (a 404, where
  // `hydrate()` never runs at all) - `overlay.ts` waits on this event before
  // it's safe to touch the DOM (see `hydrated-event.ts`), and it must not
  // wait forever just because there was nothing to hydrate.
  try {
    const match = await resolveClientMatch();
    // A route miss here also covers the server having rendered the
    // `404.tsx`/redirect fallback (`page-handler.ts`) for this URL - neither
    // is addressable through the normal segment tree, so there's nothing
    // for this client bundle to independently re-derive and hydrate. A
    // static `404.tsx` (no interactive islands) needs nothing more; one
    // that added its own `useState`/etc. would stay inert - a known,
    // accepted gap of this MPA hydration model rather than something worth
    // teaching the client bundle the server's own redirect/404 resolution
    // for.
    if (!match) return;

    const logElement = document.getElementById("dry-replay-data");
    setReplayLog(logElement?.textContent ? decodeCallLog(logElement.textContent) : []);
    // Same `match.params` the server seeded its own `DryRequestContext` with -
    // re-derived here from the identical `matchRoute()` call above, so the
    // ambient `params()` global (`params-reader-client.ts`) returns the same
    // value during hydration as it did during SSR.
    setCurrentParams(match.params);

    const vnode = await resolveMatchToVNode(match);
    hydrate(vnode as never);
  } finally {
    // The flag lets a listener attached AFTER this point (`overlay.ts`'s
    // `whenHydrated`) skip straight past the event it necessarily missed.
    (window as { dryHydrated?: boolean }).dryHydrated = true;
    window.dispatchEvent(new Event(HYDRATED_EVENT));
  }
}

void main();
