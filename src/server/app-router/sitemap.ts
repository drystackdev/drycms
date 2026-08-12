import { loadSeoDefaults, mergeSeoLayers, type DrySeoValue } from "../../content-types/dry-seo.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { DryRouteContext } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { path as adminPath } from "../config.js";
import { collectionTypeForPageSource } from "./page-collection.js";
import { buildManifestRouteTree, listDynamicPageTemplates } from "./route-manifest.js";
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
 * `sitemap.xml` (DEV only now - see `page-handler.ts`'s `/sitemap.xml`
 * branch, prod serves `buildSitemapResponseFromRegistry` below): static
 * pages from the route tree (`route-tree.ts`'s `staticPagePaths`) plus, for
 * each `[param]` route, every published entry of whichever `collection`
 * that page's own source reads (`page-collection.ts`). Driven by the ROUTE
 * TREE, not by the content types: a collection with no page of its own has
 * no URL to advertise, and the pathname comes from the real route template,
 * so nothing here can point at a path the site doesn't serve.
 *
 * An entry/the site-wide default with `noIndex` set is excluded, using the
 * exact same `mergeSeoLayers` cascade a real page render uses - not a
 * separate "should this show up" check. `features.seo` itself is NOT
 * required: a page exists whether or not its type carries SEO fields (that
 * feature only supplies the `noIndex`/meta overrides), same as the prod
 * registry branch, which never looks at it either.
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
    // `buildManifestRouteTree` (not `discoverRoutes`) whenever there IS a
    // dev source: both build the same tree from the same file list, but only
    // the manifest one's loaders carry the source path back out, which is
    // what `listDynamicPageTemplates` below needs to read a page's own code.
    const paths = devPagesSource ? await devPagesSource.listPaths() : null;
    const tree = paths ? buildManifestRouteTree(paths) : await discoverRoutes();
    for (const staticPath of staticPagePaths(tree)) {
      locs.push(`${origin}${staticPath}`);
    }
    for (const template of paths ? listDynamicPageTemplates(tree) : []) {
      const type = collectionTypeForPageSource(await devPagesSource!.readSource(template.entryPath), allTypes);
      if (!type) continue;
      for await (const value of publishedEntries(entries, type, allTypes)) {
        const seo = mergeSeoLayers({ default: defaultSeo, entry: value.seo as DrySeoValue | undefined });
        if (seo.noIndex === true) continue;
        const slug = typeof value.slug === "string" ? value.slug : "";
        if (!slug) continue;
        locs.push(`${origin}${template.pathnameTemplate.replace(`[${template.paramName}]`, slug)}`);
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

/** `edge-cache.ts`'s `storeEdgeCache`'s `ttlSeconds` for `sitemap.xml` (mục
 * 14). Used to be capped down to exactly when the next `schedule`d page
 * would go live (a page-level staged-publish concept, since removed in
 * favor of the entry-level `features.schedule` gate alone) - now just a
 * flat 24h, since nothing can ever go live later than its own build. */
export const SITEMAP_EDGE_TTL_SECONDS = 86_400;

/**
 * Registry-backed sitemap (`plans/app-r2.md` mục 8) - what PROD serves
 * (`page-handler.ts`'s `/sitemap.xml` branch; dev keeps
 * `buildSitemapResponse` above, since `_pages` only holds whatever has
 * actually been built through `/dry/page-build`). Reads `_pages`
 * (`pagesRegistry.listSitemapEntries`) instead of looping every
 * collection's published entries directly - the whole point of mục 5's
 * registry: `in_sitemap` and `lastmod` were already decided for real, at
 * build time, by whichever page actually rendered (fixes the ORIGINAL
 * `buildSitemapResponse`'s own documented limitation above: a static page's
 * own `noIndex` isn't reflected there because checking it would mean
 * actually rendering the page - here it already WAS rendered, before this
 * function ever runs).
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
    : (await pagesRegistry.listSitemapEntries()).map((entry) => ({
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
