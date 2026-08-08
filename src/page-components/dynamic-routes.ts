import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import type { DynamicPageTemplate } from "../server/app-router/route-manifest.js";
import type { ContentTypeDefinition } from "../content-types/types.js";

/**
 * `plans/app-r2.md` mục 4 - "liệt kê param cho route động", the
 * `generateStaticParams`-equivalent. Resolves each `[param]` template
 * (`route-manifest.ts`'s `listDynamicPageTemplates`) to a concrete list of
 * real pages by matching it against a content type's `seoUrlPattern` - the
 * SAME (and only) collection->route association this codebase already has
 * (`sitemap.ts`'s own doc comment: "không có formal collection->route
 * mapping elsewhere"). No new config field: `{slug}` in `seoUrlPattern`
 * lines up with `[paramName]` in the route template by construction.
 */

export interface ResolvedDynamicPage {
  pathname: string;
  entryPath: string;
  layoutPaths: string[];
  params: Record<string, string | string[]>;
}

export interface DynamicTemplateResolution {
  template: DynamicPageTemplate;
  /** `null` when no collection's `seoUrlPattern` matches this template at
   * all - the template exists in the pages tree but nothing tells the
   * build which rows it should enumerate. Surfaced to the caller to show,
   * not silently dropped. */
  type: ContentTypeDefinition | null;
  pages: ResolvedDynamicPage[];
}

function matchingType(template: DynamicPageTemplate, allTypes: ContentTypeDefinition[]): ContentTypeDefinition | null {
  const asPattern = template.pathnameTemplate.replace(`[${template.paramName}]`, "{slug}");
  return (
    allTypes.find(
      (t) => t.kind === "collection" && t.features?.slug === true && t.seoUrlPattern === asPattern,
    ) ?? null
  );
}

/** Every PUBLISHED row's `slug`, paginated - same 500-per-page loop
 * `sitemap.ts`'s `publishedEntries` uses server-side, run here through
 * `dry-http` instead of direct entries access (this is browser-side code -
 * decision #2, no direct DB access). Deliberately a RAW fetch, not routed
 * through `dry-reader-http.ts`'s tracked `dry()`: this runs BEFORE any
 * individual page build starts (it's answering "which pages exist", not
 * "what does THIS page's own render depend on"), so it must never append to
 * some page's replay log - same reasoning `page-build.ts`'s
 * `fetchSeoDefaults` already documents for its own raw fetch. */
async function fetchAllSlugs(dryHttpEndpoint: string, typeName: string): Promise<string[]> {
  const slugs: string[] = [];
  const pageSize = 500;
  for (let page = 0; ; page++) {
    const response = await fetch(dryHttpEndpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "collection", name: typeName, method: "list", selectFields: ["slug"], page, pageSize }),
    });
    if (!response.ok) break;
    const [entry] = decodeCallLog(await response.text());
    const result = entry?.result as { rows: Record<string, unknown>[]; total: number } | undefined;
    const rows = result?.rows ?? [];
    for (const row of rows) if (typeof row.slug === "string") slugs.push(row.slug);
    if (rows.length < pageSize) break;
  }
  return slugs;
}

export async function resolveDynamicPages(
  templates: DynamicPageTemplate[],
  allTypes: ContentTypeDefinition[],
  dryHttpEndpoint: string,
): Promise<DynamicTemplateResolution[]> {
  const resolutions: DynamicTemplateResolution[] = [];
  for (const template of templates) {
    const type = matchingType(template, allTypes);
    if (!type) {
      resolutions.push({ template, type: null, pages: [] });
      continue;
    }
    const slugs = await fetchAllSlugs(dryHttpEndpoint, type.name);
    const pages = slugs.map((slug) => ({
      pathname: template.pathnameTemplate.replace(`[${template.paramName}]`, slug),
      entryPath: template.entryPath,
      layoutPaths: template.layoutPaths,
      params: { [template.paramName]: slug },
    }));
    resolutions.push({ template, type, pages });
  }
  return resolutions;
}
