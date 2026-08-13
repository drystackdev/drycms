import { path as adminPath } from "./config.js";
import { getContentAdapters } from "./content-adapters.js";
import type { DryRouteContext } from "./context.js";
import { tryServeGoogleVerificationFile } from "./google-verification.js";
import { tryServeOAuthMetadata } from "./oauth-metadata.js";
import type { DryRequestContext, DryVeiContext } from "../content-types/dry-context.js";
import { loadSeoDefaults, type DrySeoLayers } from "../content-types/dry-seo.js";
import type { ContentEntryEngineAdapter } from "../content-types/engine/entries-types.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { resolveAccess } from "../content-types/access.js";
import { resolveVeiSession } from "./vei-session.js";
import { discoverRoutes, devSourcePathOf, type DevPagesSource } from "./app-router/route-tree.js";
import { matchRoute, type RouteMatch } from "./app-router/match.js";
import { renderErrorHtml, renderPage } from "./app-router/render.js";
import { readBuiltPage } from "./app-router/built-pages-storage.js";
import { resolveSiteOrigin } from "./app-router/site-origin.js";
import { buildRobotsResponse, buildSitemapResponse, buildSitemapResponseFromRegistry } from "./app-router/sitemap.js";

/**
 * Renders `src/apps/pages/**` (see `plans/app-router.md`) - the "real
 * caller" `plans/reader.md`'s Giai đoạn 4 was waiting on. Only engages
 * for a pathname OUTSIDE the admin's own `path` - symmetric to
 * `routers/App.tsx`'s `AuthGate`, which renders nothing (a blank page) for
 * exactly this space today; this fills that space with the site's own
 * content instead.
 *
 * Two entirely different code paths, chosen once per request (mục 12,
 * `plans/app-r2.md`):
 * - **Prod, no VEI session**: static-only for a real match. Reads
 *   `built/live/*` (`readBuiltPage` - whatever `/dry/page-build` last
 *   published for this pathname) and serves it as-is; no `page.tsx`/
 *   `layout.tsx` code ever executes for a MATCHED route in this branch. A
 *   miss (never built, or genuinely no such route) renders the pages-root
 *   `404.tsx` through the same lightweight `renderErrorHtml` pipeline the
 *   catch block below already uses for `500.tsx` (no `dry()` context, no
 *   layouts/hydration - just that one component) - falls back to a
 *   bare-bones plain-text 404 only when the app has no `404.tsx` at all.
 * - **Dev (always), or a VEI-authenticated session (dev + prod)**: the
 *   ORIGINAL live SSR pipeline below, byte-for-byte the same behavior
 *   this function had before mục 12 - a route MISS first checks the
 *   built-in `redirect` collection (`content-types/redirects.ts` populates
 *   it whenever a slugged entry's slug changes) by the URL's LAST path
 *   segment - a hit 301s to the same URL with that segment swapped for the
 *   redirect's `to`. Only once that also misses does it fall back to
 *   rendering the pages-root `404.tsx` (if the app has one, through the
 *   exact same `renderPage` pipeline as a real match - full layout/SEO/
 *   hydration, not a stripped-down page) - `null` only when there's truly
 *   nothing to render (no `404.tsx` either), same contract as before: the
 *   caller (dev-server/entry-node/entry-worker) decides what a bare-bones
 *   404 response looks like in that case.
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
 * piece whose whole job is to reflect the live source's current state
 * (`app-router.md`'s "trên dev có thể vào xem trực tiếp live preview qua
 * vite"), so the dev-server wiring loads THIS module fresh on every
 * request too - see the "Nối dev" step in `plans/app-router.md`. In dev
 * that live source is `devPagesSource` (`pagesSourceStorage`, i.e. `.dry/
 * pages-source`) when the caller supplies one - see `DevPagesSource`'s own
 * doc comment (`route-tree.ts`) for why. Production never supplies one, so
 * it keeps reading `src/apps/pages` through the unchanged Vite-glob branch.
 */
export async function handlePageRequest(
  request: Request,
  env: Record<string, unknown> = {},
  // Defaults to the real Vite-define value every real caller (`entry-node.ts`,
  // `entry-worker.ts`, `scripts/dev-server.mjs`) already relies on implicitly -
  // none of them pass this explicitly, so none of them change behavior.
  // Exists as its own parameter ONLY for `page-handler.test.ts`: Vitest's own
  // `mode` is `"test"`, and Vite defines `DEV` as `mode !== "production"` -
  // found live, this makes `import.meta.env.DEV` read `true` under Vitest,
  // same as a real dev server, with no way to observe mục 12's prod-only
  // branch from a plain `import.meta.env.DEV` read at all. A REAL production
  // build (`vite build --ssr ...`, what `entry-node.ts`/`entry-worker.ts`
  // actually ship) has never had this ambiguity - `mode` defaults to
  // `"production"` for a build command regardless of Vitest.
  isDev: boolean = import.meta.env.DEV,
  // Only `scripts/dev-server.mjs` ever passes this (see `DevPagesSource`'s
  // own doc comment) - `entry-node.ts`/`entry-worker.ts` never do, so
  // production always takes `discoverRoutes()`'s unchanged glob branch.
  devPagesSource?: DevPagesSource,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === adminPath || url.pathname.startsWith(`${adminPath}/`)) {
    return null;
  }

  // Session support (preview/draft mode) is deferred to Giai đoạn 4 -
  // `null` unconditionally for now rather than parsing a cookie nothing
  // reads yet.
  const routeContext: DryRouteContext = { request, url, params: {}, env, session: null };

  const verificationResponse = await tryServeGoogleVerificationFile(request, routeContext);
  if (verificationResponse) return verificationResponse;

  const oauthMetadataResponse = tryServeOAuthMetadata(request);
  if (oauthMetadataResponse) return oauthMetadataResponse;

  // Not real `page.tsx` routes (XML/plain text, not HTML) - handled here,
  // before routing, with their own try/catch rather than the big one below:
  // a failure building either shouldn't render `500.tsx` (an HTML fallback
  // makes no sense for a feed a crawler is fetching).
  if (url.pathname === "/sitemap.xml") {
    try {
      // Mục 8 (`plans/app-r2.md`): prod only ever serves what's actually
      // built (`_pages`, below) - listing a collection's live-queried
      // published entries there too would advertise URLs to search
      // engines that 404 the moment `!isDev` reads them back (see this
      // function's own prod branch below). Dev keeps the original
      // direct-D1 version: `_pages` only has rows for whatever's been
      // explicitly built through `/dry/page-build`, which a dev instance
      // mid-development usually hasn't done for most pages.
      return await (isDev ? buildSitemapResponse(url, routeContext, devPagesSource) : buildSitemapResponseFromRegistry(url, routeContext));
    } catch (error) {
      console.error("[drycms] sitemap.xml render failed:", error);
      return new Response("", { status: 500 });
    }
  }
  if (url.pathname === "/robots.txt") {
    return buildRobotsResponse(url);
  }

  const routeTree = await discoverRoutes(isDev ? devPagesSource : undefined);
  const match = matchRoute(routeTree.root, url.pathname);

  try {
    const { schema, entries } = getContentAdapters(routeContext);
    const allTypes = await schema.listContentTypes();

    const vei = await resolveVeiContext(request, env, entries, allTypes);

    // Mục 12 (`plans/app-r2.md`): prod (`!isDev`) never
    // renders a page live anymore - it ONLY serves whatever's already sitting
    // in `built/live/*` (`readBuiltPage`, mục 7's build pipeline output,
    // published from `/dry/page-build`), or 404s. No version comparison
    // (unlike the old `pages-cache.ts`'s `PageCacheEnvelope`, now deleted): a
    // page whose content changed since it was last built keeps serving its
    // last-built HTML until someone rebuilds it - a stale page beats a
    // missing one, and staleness is surfaced to the ADMIN (`_pages`'s
    // `staleResource`, `PageBuild.tsx`'s status column), not the visitor.
    //
    // VEI is carved out of this branch, in BOTH dev and prod: a built page's
    // HTML never carries edit markers (`page-build.ts` renders every
    // `dryBind()` as an inert, marker-free ref - see its own test's doc
    // comment), so the full click-to-edit experience (hover highlight,
    // per-field editing) genuinely cannot work purely against static output
    // yet. Until that's addressed (a separate, not-yet-scoped follow-up -
    // see `status/app-r2-build.md`), a VEI session keeps getting the exact
    // same live SSR-with-edit-markers render it already gets today, in prod
    // as well as dev - a deliberate, documented deviation from mục 12's
    // literal text ("VEI chạy trên HTML tĩnh"), not an oversight.
    if (!isDev && !vei) {
      const cached = await readBuiltPage(routeContext, url.pathname);
      if (cached !== null) {
        return new Response(cached, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      // A live-key miss means "never built through `/dry/page-build`" - full
      // stop. There used to be a page-level `schedule`/`publishAt` staged-
      // build concept promoted lazily right here; removed in favor of the
      // entry-level `features.schedule` gate alone (`entry-where.ts`'s
      // `buildPublishedOnlyClause`) - a build always publishes immediately
      // now (`writeBuiltPage` always writes the live key).
      // Same reasoning `findRedirectResponse`'s own doc comment already
      // gives for running this AFTER a cache check rather than before -
      // still applies unchanged, just against `readBuiltPage` instead of
      // the old `readPageCache`.
      const redirectResponse = await findRedirectResponse(url, entries, allTypes);
      if (redirectResponse) return redirectResponse;
      if (routeTree.notFound) {
        const html = await renderErrorHtml(routeTree.notFound);
        return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    // Dev (always) and a VEI session (dev + prod) reach here - the ORIGINAL
    // live SSR pipeline, unchanged from before mục 12.
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

    // No `onDocumentReady` - that was `writePageCache`'s hook into the old
    // implicit per-request cache-on-render-miss scheme (`pages-cache.ts`,
    // deleted). This branch only ever runs for dev or a VEI session now,
    // and neither one EVER wrote to that cache even before mục 12 (see the
    // git history of this file) - there is no longer a caller left who
    // needs this hook at all.
    // `devSourcePathOf` only returns a real path for a loader THIS branch's
    // own `discoverRoutes(devPagesSource)` call tagged - i.e. exactly when
    // `isDev && devPagesSource` above, so this can't misfire for the prod
    // glob branch. See `DevPagesSource`'s doc comment (`route-tree.ts`) for
    // why the client needs these URLs at all.
    const entryDevPath = devPagesSource ? devSourcePathOf(resolvedMatch.page) : undefined;
    const devHydrateManifest = devPagesSource && entryDevPath
      ? {
          entryUrl: devPagesSource.browserUrlFor(entryDevPath),
          layoutUrls: resolvedMatch.layouts.map((layout) => devPagesSource.browserUrlFor(devSourcePathOf(layout)!)),
          params: resolvedMatch.params,
        }
      : undefined;

    const response = renderPage(resolvedMatch, dryContext, {
      status,
      // `render.ts` already logs the error before calling this - only
      // building the fallback document is left to do here.
      onRenderError: routeTree.serverError ? () => renderErrorHtml(routeTree.serverError!) : undefined,
      devHydrateManifest,
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
 * ordinary anonymous case (no `drycms_vei` cookie, or an expired/revoked
 * one) - any signed-in admin session gets edit rights, no separate
 * permission to hold. Per-type editability is still resolved from the
 * viewer's actual role grants below, so `canUpdate` only opens up fields the
 * viewer could otherwise save through the admin.
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
