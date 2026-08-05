import { path as adminPath } from "./config.js";
import { getContentAdapters } from "./content-adapters.js";
import type { DryRouteContext } from "./context.js";
import type { DryRequestContext } from "../content-types/dry-context.js";
import type { DrySeoLayers, DrySeoValue } from "../content-types/dry-seo.js";
import { discoverRoutes } from "./app-router/route-tree.js";
import { matchRoute } from "./app-router/match.js";
import { renderPage } from "./app-router/render.js";
import { readPageCache, writePageCache } from "./app-router/pages-cache.js";

/**
 * Renders `src/apps/pages/**` (see `plans/app-router.md`) - the "real
 * caller" `plans/reader.md`'s Giai đoạn 4 was waiting on. Only engages
 * for a pathname OUTSIDE the admin's own `path` - symmetric to
 * `routers/App.tsx`'s `AuthGate`, which renders nothing (a blank page) for
 * exactly this space today; this fills that space with the site's own
 * content instead. `null` return = no matching route - caller (dev-server/
 * entry-node) decides what a real 404 response looks like, this function
 * never invents one itself.
 *
 * `discoverRoutes()` is called fresh per request (not cached at module
 * scope) so a page/layout added while the dev server is running is picked
 * up without a restart - unlike most of `src/server/**`, whose modules
 * `scripts/dev-server.mjs` loads once at boot, this module is the one
 * piece whose whole job is to reflect `src/apps/pages/**`'s live state
 * (`app-router.md`'s "trên dev có thể vào xem trực tiếp live preview qua
 * vite"), so the dev-server wiring loads THIS module fresh on every
 * request too - see the "Nối dev" step in `plans/app-router.md`.
 */
export async function handlePageRequest(
  request: Request,
  env: Record<string, unknown> = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === adminPath || url.pathname.startsWith(`${adminPath}/`)) {
    return null;
  }

  const routeTree = discoverRoutes();
  const match = matchRoute(routeTree, url.pathname);
  if (!match) return null;

  // Session support (preview/draft mode) is deferred to Giai đoạn 4 -
  // `null` unconditionally for now rather than parsing a cookie nothing
  // reads yet.
  const routeContext: DryRouteContext = { request, url, params: {}, env, session: null };
  const { schema, entries } = getContentAdapters(routeContext);
  const allTypes = await schema.listContentTypes();

  // pages-cache only runs in production - a version-based cache has no way
  // to detect a `page.tsx`/`layout.tsx` CODE edit (only content changes),
  // which would make dev's "live preview qua vite" show stale output after
  // editing a page - see `plans/app-router.md`'s "Chỉ bật ở production".
  if (!import.meta.env.DEV) {
    const cached = await readPageCache(routeContext, url.pathname, entries, allTypes);
    if (cached !== null) {
      return new Response(cached, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }

  const touchedTypes = new Set<string>();
  const callLog: DryRequestContext["callLog"] = [];
  const seo: DrySeoLayers = {};
  // Seeds the SEO cascade's "Default" layer once per request - the one
  // layer no page/layout ever fetches on its own (see `dry-seo.ts`'s
  // `seoTierFor`), so it has to be done here rather than as a side effect
  // of some `dry()` call. Driven by `features.seoDefault`, not a hardcoded
  // type name, so this stays generic across drycms projects.
  const seoDefaultsType = allTypes.find((t) => t.kind === "singleton" && t.features?.seoDefault);
  if (seoDefaultsType) {
    const row = await entries.getSingletonEntry(seoDefaultsType, allTypes);
    const value = row?.value.seo;
    if (value && typeof value === "object") seo.default = value as DrySeoValue;
  }
  const dryContext: DryRequestContext = { entries, allTypes, touchedTypes, callLog, seo };

  return renderPage(match, dryContext, {
    onDocumentReady: (fullHtml) => {
      if (import.meta.env.DEV) return;
      void writePageCache(routeContext, url.pathname, fullHtml, touchedTypes, entries, allTypes);
    },
  });
}
