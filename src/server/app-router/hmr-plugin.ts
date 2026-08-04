import type { Plugin } from "vite";

const RELOAD_TRIGGER = /\/src\/apps\/(pages\/|globals\.css$)/;

/**
 * App Router pages/layouts render entirely server-side for now (no client
 * bundle yet - Giai đoạn 1/2 of `plans/app-router.md`, hydration still
 * pending), so Vite's own HMR client never builds a module-graph
 * connection to them - nothing in the browser ever `import()`s a
 * `page.tsx`, so Vite's default "walk up to an accept boundary" HMR logic
 * has nothing to walk from. A blanket full-reload on any relevant file
 * change is the standard fallback for this shape of SSR-only dev setup.
 * `render.ts` injects the `/@vite/client` script (dev only) this reload
 * signal needs a live WebSocket connection for.
 *
 * Known v1 tradeoff: the reload broadcast is unscoped (no `path` filter),
 * so a browser tab with the admin SPA open at the same time also reloads
 * when an App Router page changes - minor, not scoping it now to avoid
 * guessing at Vite's client-side path-matching semantics without a real
 * need yet.
 */
export function appRouterHmrPlugin(): Plugin {
  return {
    name: "app-router-hmr",
    handleHotUpdate({ file, server }) {
      if (!RELOAD_TRIGGER.test(file)) return;
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
