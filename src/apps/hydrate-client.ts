import hydrate from "preact-iso/hydrate";
import { setReplayLog } from "../content-types/dry-reader-client.js";
import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import { matchRoute } from "../server/app-router/match.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import { discoverRoutes } from "../server/app-router/route-tree.js";

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
  const match = matchRoute(discoverRoutes(), window.location.pathname);
  if (!match) return; // The server already 404'd for this URL - nothing to hydrate.

  const logElement = document.getElementById("dry-replay-data");
  setReplayLog(logElement?.textContent ? decodeCallLog(logElement.textContent) : []);

  const vnode = await resolveMatchToVNode(match);
  hydrate(vnode as never);
}

void main();
