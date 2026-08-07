import { path as adminPath } from "./config.js";
import { getContentAdapters } from "./content-adapters.js";
import type { DryRouteContext } from "./context.js";
import type { DryRequestContext, DryVeiContext } from "../content-types/dry-context.js";
import { loadSeoDefaults, type DrySeoLayers } from "../content-types/dry-seo.js";
import type { ContentEntryEngineAdapter } from "../content-types/engine/entries-types.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { VEI_RESOURCE_ID } from "../content-types/permissions.js";
import { resolveAccess } from "../content-types/access.js";
import { resolveVeiSession } from "./vei-session.js";
import { discoverRoutes } from "./app-router/route-tree.js";
import { matchRoute, type RouteMatch } from "./app-router/match.js";
import { renderErrorHtml, renderPage } from "./app-router/render.js";
import { readPageCache, writePageCache } from "./app-router/pages-cache.js";
import { resolveSiteOrigin } from "./app-router/site-origin.js";
import { buildRobotsResponse, buildSitemapResponse } from "./app-router/sitemap.js";

/**
 * Renders `src/apps/pages/**` (see `plans/app-router.md`) - the "real
 * caller" `plans/reader.md`'s Giai đoạn 4 was waiting on. Only engages
 * for a pathname OUTSIDE the admin's own `path` - symmetric to
 * `routers/App.tsx`'s `AuthGate`, which renders nothing (a blank page) for
 * exactly this space today; this fills that space with the site's own
 * content instead.
 *
 * A route MISS is no longer automatically a 404: it first checks the
 * built-in `redirect` collection (`content-types/redirects.ts` populates it
 * whenever a slugged entry's slug changes) by the URL's LAST path segment -
 * a hit 301s to the same URL with that segment swapped for the redirect's
 * `to`. Only once that also misses does it fall back to rendering the
 * pages-root `404.tsx` (if the app has one, through the exact same
 * `renderPage` pipeline as a real match - full layout/SEO/hydration, not a
 * stripped-down page) - `null` only when there's truly nothing to render
 * (no `404.tsx` either), same contract as before: the caller (dev-server/
 * entry-node/entry-worker) decides what a bare-bones 404 response looks
 * like in that case.
 *
 * A failure anywhere in this function's own setup (schema/content adapters,
 * SEO defaults, VEI session) is caught below and rendered through the
 * pages-root `500.tsx` (if present) instead of propagating - see that
 * catch's own comment for what it does and doesn't cover.
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

  // Session support (preview/draft mode) is deferred to Giai đoạn 4 -
  // `null` unconditionally for now rather than parsing a cookie nothing
  // reads yet.
  const routeContext: DryRouteContext = { request, url, params: {}, env, session: null };

  // Not real `page.tsx` routes (XML/plain text, not HTML) - handled here,
  // before routing, with their own try/catch rather than the big one below:
  // a failure building either shouldn't render `500.tsx` (an HTML fallback
  // makes no sense for a feed a crawler is fetching).
  if (url.pathname === "/sitemap.xml") {
    try {
      return await buildSitemapResponse(url, routeContext);
    } catch (error) {
      console.error("[drycms] sitemap.xml render failed:", error);
      return new Response("", { status: 500 });
    }
  }
  if (url.pathname === "/robots.txt") {
    return buildRobotsResponse(url);
  }

  const routeTree = discoverRoutes();
  const match = matchRoute(routeTree.root, url.pathname);

  try {
    const { schema, entries } = getContentAdapters(routeContext);
    const allTypes = await schema.listContentTypes();

    // Checked BEFORE routing, and unconditionally - not only when `match` is
    // null. A dynamic `[slug]` route (e.g. `/blogs/[slug]`) matches ANY slug
    // syntactically, valid or not; the "this specific post doesn't exist"
    // case only surfaces once the page's own `dry()` lookup comes up empty,
    // which `page-handler.ts` has no visibility into (the page renders its
    // own "not found" markup at a normal 200 status - see
    // `blogs/[slug]/page.tsx`). Running this check first, always, is what
    // actually catches a renamed slug's old URL - a genuine route miss
    // reaches the same check with the same result (usually no match, falls
    // through below), just via a different path. Known trade-off (accepted
    // when this matching strategy was chosen over a per-content-type URL
    // prefix): ANY path's last segment - including a static page's, like
    // `/about` - could theoretically collide with an unrelated stale
    // redirect and get 301'd instead of rendering normally.
    const redirectResponse = await findRedirectResponse(url, entries, allTypes);
    if (redirectResponse) return redirectResponse;

    if (!match && !routeTree.notFound) return null;
    // A route miss with a `404.tsx` renders through the SAME pipeline as a
    // real match below, wrapped by the root layout only (a nested layout
    // has no meaning for a path that didn't resolve to anywhere under it).
    const resolvedMatch: RouteMatch = match ?? {
      page: routeTree.notFound!,
      layouts: routeTree.root.layout ? [routeTree.root.layout] : [],
      params: {},
    };
    const status = match ? 200 : 404;

    const vei = await resolveVeiContext(request, env, entries, allTypes);

    // pages-cache only runs in production, and only for a real match - a
    // version-based cache has no way to detect a `page.tsx`/`layout.tsx`
    // CODE edit (only content changes), which would make dev's "live
    // preview qua vite" show stale output after editing a page - see
    // `plans/app-router.md`'s "Chỉ bật ở production". An edit-mode render is
    // excluded on BOTH sides: its markup carries per-viewer editing
    // metadata, so serving it from - or writing it into - a cache shared
    // with anonymous visitors would be wrong in both directions.
    if (match && !import.meta.env.DEV && !vei) {
      const cached = await readPageCache(routeContext, url.pathname, entries, allTypes);
      if (cached !== null) {
        return new Response(cached, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    }

    const touchedTypes = new Set<string>();
    const callLog: DryRequestContext["callLog"] = [];
    // Seeds the SEO cascade's "Default" layer once per request - the one
    // layer no page/layout ever fetches on its own (see `dry-seo.ts`'s
    // `seoTierFor`), so it has to be done here rather than as a side effect
    // of some `dry()` call. `loadSeoDefaults` is shared with `sitemap.ts`,
    // which needs the exact same site-wide lookup.
    const seo: DrySeoLayers = { default: await loadSeoDefaults(entries, allTypes) };
    const dryContext: DryRequestContext = {
      entries,
      allTypes,
      touchedTypes,
      callLog,
      seo,
      params: resolvedMatch.params,
      vei,
      origin: resolveSiteOrigin(url),
      pathname: url.pathname,
    };

    const response = renderPage(resolvedMatch, dryContext, {
      status,
      onDocumentReady: (fullHtml) => {
        if (!match || import.meta.env.DEV || vei) return;
        void writePageCache(routeContext, url.pathname, fullHtml, touchedTypes, entries, allTypes);
      },
      // `render.ts` already logs the error before calling this - only
      // building the fallback document is left to do here.
      onRenderError: routeTree.serverError ? () => renderErrorHtml(routeTree.serverError!) : undefined,
    });
    if (vei) response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    // Covers failures in THIS function's own setup (schema/content adapters,
    // SEO defaults, VEI session) - anything before `renderPage` was called.
    // A failure inside `renderPage` itself (a specific page's own render)
    // is a separate, later moment this `catch` can't observe - see that
    // function's `onRenderError` option above and its own doc comment for
    // why a page miss there is only fixable up to a point.
    if (!routeTree.serverError) throw error;
    console.error("[drycms] page render setup failed:", error);
    const html = await renderErrorHtml(routeTree.serverError);
    return new Response(html, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

/** Swaps `pathname`'s last non-empty segment for `replacement` - e.g.
 * `/blogs/old-post` + `new-post` -> `/blogs/new-post`. A trailing slash is
 * dropped in the process (same normalization `match.ts`'s own
 * `pathname.split("/").filter(Boolean)` already applies). */
function replaceLastSegment(pathname: string, replacement: string): string {
  const segments = pathname.split("/").filter(Boolean);
  segments[segments.length - 1] = replacement;
  return `/${segments.join("/")}`;
}

/**
 * The redirect side of `content-types/redirects.ts` - matches purely by the
 * URL's last path segment (no per-content-type URL-prefix config needed),
 * so it works for `/blogs/[slug]` today and any future `[slug]` route
 * without extra setup. `null` when there's no matching `redirect` row (or
 * the app's content types don't include one at all).
 */
async function findRedirectResponse(
  url: URL,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
): Promise<Response | null> {
  const segments = url.pathname.split("/").filter(Boolean);
  const oldSlug = segments[segments.length - 1];
  if (!oldSlug) return null;
  const redirectType = allTypes.find((t) => t.name === "redirect" && t.kind === "collection");
  if (!redirectType) return null;

  const row = await entries.findEntry(redirectType, allTypes, [{ field: "from", op: "eq", value: oldSlug }]);
  if (!row || typeof row.value.to !== "string") return null;

  const target = new URL(replaceLastSegment(url.pathname, row.value.to) + url.search, url);
  return new Response(null, { status: 301, headers: { Location: target.toString() } });
}

/**
 * The viewer's editing rights for this render, or `undefined` for the
 * ordinary anonymous case (no `drycms_vei` cookie, an expired/revoked one, a
 * signed-in user whose roles grant no content permission at all, or one
 * whose `system-vei` grant (`permissions.ts`) was revoked after the cookie
 * was minted - re-checked here every render so edit mode/highlighting drops
 * out the next page load rather than staying live for the cookie's full
 * `VEI_MAX_AGE_SECONDS`, same check `vei-routes.ts`'s `hasVeiAccess` does at
 * mint time.
 * Permissions are resolved once per request and closed over, so marking a
 * value costs a map lookup rather than a role query per field.
 */
async function resolveVeiContext(
  request: Request,
  env: Record<string, unknown>,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
): Promise<DryVeiContext | undefined> {
  const session = await resolveVeiSession(request, env);
  if (!session) return undefined;
  const access = await resolveAccess(entries, allTypes, session);
  if (!access) return undefined;
  if (!access.can(VEI_RESOURCE_ID, "setting")) return undefined;
  const editable = new Map<string, boolean>();
  return {
    canUpdate(type) {
      const cached = editable.get(type.id);
      if (cached !== undefined) return cached;
      // A singleton's schema collapses every action into one `setting`
      // grant - see `permissions.ts`'s `permissionActionsFor`.
      const allowed = type.kind === "singleton" ? access.can(type.id, "setting") : access.can(type.id, "update");
      editable.set(type.id, allowed);
      return allowed;
    },
  };
}
