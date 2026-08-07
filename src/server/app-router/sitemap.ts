import { loadSeoDefaults, mergeSeoLayers, type DrySeoValue } from "../../content-types/dry-seo.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { DryRouteContext } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { path as adminPath } from "../config.js";
import { discoverRoutes, staticPagePaths } from "./route-tree.js";
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
export async function buildSitemapResponse(url: URL, routeContext: DryRouteContext): Promise<Response> {
  const { schema, entries } = getContentAdapters(routeContext);
  const allTypes = await schema.listContentTypes();
  const origin = resolveSiteOrigin(url);

  const defaultSeo = await loadSeoDefaults(entries, allTypes);
  const siteNoIndex = mergeSeoLayers({ default: defaultSeo }).noIndex === true;

  const locs: string[] = [];
  if (!siteNoIndex) {
    for (const staticPath of staticPagePaths(discoverRoutes())) {
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
