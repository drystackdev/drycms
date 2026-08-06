import hydrate from "preact-iso/hydrate";
import { setReplayLog } from "../content-types/dry-reader-client.js";
import { setCurrentParams } from "../content-types/params-reader-client.js";
import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import { matchRoute } from "../server/app-router/match.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import { discoverRoutes } from "../server/app-router/route-tree.js";
import { HYDRATED_EVENT } from "./hydrated-event.js";

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
    const match = matchRoute(discoverRoutes().root, window.location.pathname);
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
