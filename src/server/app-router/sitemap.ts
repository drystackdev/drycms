import { loadSeoDefaults, mergeSeoLayers, type DrySeoValue } from "../../content-types/dry-seo.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { PagesRegistryAdapter } from "../../content-types/engine/pages-registry-types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { DryRouteContext } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { path as adminPath } from "../config.js";
import { discoverRoutes, staticPagePaths, type DevPagesSource } from "./route-tree.js";
import { resolveSiteOrigin } from "./site-origin.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Every published entry of one `collection` type, in `pageSize`-sized pages,
 * newest-id-first order irrelevant (a sitemap has no ordering requirement) -
 * looped locally here rather than adding a "list all" method to
 * `ContentEntryEngineAdapter` (`entries-types.ts`), since this is this
 * function's only caller.
 */
async function* publishedEntries(
  entries: ContentEntryEngineAdapter,
  type: ContentTypeDefinition,
  allTypes: ContentTypeDefinition[],
): AsyncGenerator<Record<string, unknown>> {
  const pageSize = 500;
  let page = 0;
  for (;;) {
    const result = await entries.listEntries(type, allTypes, { page, pageSize, publishedOnly: true });
    for (const row of result.rows) yield row.value;
    if (result.rows.length < pageSize) return;
    page += 1;
  }
}

/**
 * `sitemap.xml` - static pages (from the route tree, see `route-tree.ts`'s
 * `staticPagePaths`) plus every published entry of every `collection` with
 * `features.seo && features.slug && seoUrlPattern` set (`types.ts`'s doc
 * comment on `seoUrlPattern` - no formal collection->route mapping exists
 * elsewhere, so a collection with that field unset is silently left out).
 * An entry/the site-wide default with `noIndex` set is excluded, using the
 * exact same `mergeSeoLayers` cascade a real page render uses - not a
 * separate "should this show up" check.
 *
 * Known, accepted limitation (same category as `page-handler.ts`'s
 * `findRedirectResponse` doc comment): a STATIC page's own `noIndex` (set on
 * a seo-enabled singleton) is NOT reflected here, only the site-wide default
 * and per-entry values - checking a static page's own SEO would mean
 * actually rendering it.
 */
export async function buildSitemapResponse(url: URL, routeContext: DryRouteContext, devPagesSource?: DevPagesSource): Promise<Response> {
  const { schema, entries } = getContentAdapters(routeContext);
  const allTypes = await schema.listContentTypes();
  const origin = resolveSiteOrigin(url);

  const defaultSeo = await loadSeoDefaults(entries, allTypes);
  const siteNoIndex = mergeSeoLayers({ default: defaultSeo }).noIndex === true;

  const locs: string[] = [];
  if (!siteNoIndex) {
    for (const staticPath of staticPagePaths(await discoverRoutes(devPagesSource))) {
      locs.push(`${origin}${staticPath}`);
    }
    for (const type of allTypes) {
      if (type.kind !== "collection" || !type.features?.seo || !type.features.slug || !type.seoUrlPattern) continue;
      for await (const value of publishedEntries(entries, type, allTypes)) {
        const seo = mergeSeoLayers({ default: defaultSeo, entry: value.seo as DrySeoValue | undefined });
        if (seo.noIndex === true) continue;
        const slug = typeof value.slug === "string" ? value.slug : "";
        if (!slug) continue;
        locs.push(`${origin}${type.seoUrlPattern.replace("{slug}", slug)}`);
      }
    }
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    locs.map((loc) => `<url><loc>${escapeXml(loc)}</loc></url>`).join("") +
    "</urlset>";
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

/** `robots.txt` - points at `sitemap.xml`, disallows the admin path. */
export function buildRobotsResponse(url: URL): Response {
  const origin = resolveSiteOrigin(url);
  const body = `User-agent: *\nDisallow: ${adminPath}/\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

const DEFAULT_SITEMAP_EDGE_TTL_SECONDS = 86_400;

/**
 * `edge-cache.ts`'s `storeEdgeCache`'s `ttlSeconds` for `sitemap.xml` (mục
 * 14): 24h when nothing is scheduled, capped down to exactly when the next
 * `schedule`d page goes live otherwise - a bare 24h TTL would otherwise
 * leave a just-published page missing from a CACHED sitemap for up to a
 * full day. Cheap on the common "nothing scheduled" path: one `MIN(...)`
 * query (mục 9's cron sweep needs the identical query for its own fast
 * empty-case exit, so this is never a new kind of cost, just a second
 * caller of it).
 */
export async function sitemapEdgeCacheTtlSeconds(pagesRegistry: PagesRegistryAdapter, nowMs: number): Promise<number> {
  const nextPublishAt = await pagesRegistry.nextPublishAt(nowMs);
  if (nextPublishAt === null) return DEFAULT_SITEMAP_EDGE_TTL_SECONDS;
  const secondsUntilDue = Math.floor((nextPublishAt - nowMs) / 1000);
  return Math.max(1, Math.min(DEFAULT_SITEMAP_EDGE_TTL_SECONDS, secondsUntilDue));
}

/**
 * Registry-backed sitemap (`plans/app-r2.md` mục 8) - NOT wired in as a
 * replacement for `buildSitemapResponse` anywhere (`page-handler.ts` still
 * calls the original, unchanged). Reads `_pages` (`pagesRegistry.
 * listSitemapEntries`) instead of looping every collection's published
 * entries directly - the whole point of mục 5's registry: `in_sitemap` and
 * `lastmod` were already decided for real, at build time, by whichever page
 * actually rendered (fixes the ORIGINAL `buildSitemapResponse`'s own
 * documented limitation above: a static page's own `noIndex` isn't
 * reflected there because checking it would mean actually rendering the
 * page - here it already WAS rendered, before this function ever runs).
 *
 * Flipping `page-handler.ts`'s `/sitemap.xml` branch over to this is
 * deliberately left undone (see `status/app-r2-build.md`): on a site with
 * no pages built through the new pipeline yet, `_pages` is empty and this
 * would return a sitemap with zero URLs, silently breaking the CURRENTLY
 * WORKING sitemap on first deploy - a decision for whoever has actually run
 * a real build pass, not a side effect of adding this function.
 *
 * `siteNoIndex` is the ONE thing still read live rather than off the
 * registry (mục 8's own text: "Giữ live query đúng 1 thứ") - a runtime
 * setting (`seoDefaults.seo.noIndex`) that can flip between builds, and
 * checking it costs one singleton read, not a scan of every row.
 */
export async function buildSitemapResponseFromRegistry(url: URL, routeContext: DryRouteContext): Promise<Response> {
  const { schema, entries, pagesRegistry } = getContentAdapters(routeContext);
  const allTypes = await schema.listContentTypes();
  const origin = resolveSiteOrigin(url);

  const defaultSeo = await loadSeoDefaults(entries, allTypes);
  const siteNoIndex = mergeSeoLayers({ default: defaultSeo }).noIndex === true;

  const locs: { loc: string; lastmod: string }[] = siteNoIndex
    ? []
    : (await pagesRegistry.listSitemapEntries(Date.now())).map((entry) => ({
        loc: `${origin}${entry.path}`,
        lastmod: new Date(entry.builtAt).toISOString(),
      }));

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    locs.map(({ loc, lastmod }) => `<url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`).join("") +
    "</urlset>";
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
