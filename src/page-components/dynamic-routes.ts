import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import { collectionTypeForPageSource } from "../server/app-router/page-collection.js";
import type { DynamicPageTemplate } from "../server/app-router/route-manifest.js";
import type { ContentTypeDefinition } from "../content-types/types.js";

/**
 * `plans/app-r2.md` mục 4 - "liệt kê param cho route động", the
 * `generateStaticParams`-equivalent. Resolves each `[param]` template
 * (`route-manifest.ts`'s `listDynamicPageTemplates`) to a concrete list of
 * real pages by reading which collection the template's own `page.tsx`
 * fetches its entry from (`page-collection.ts`) - no config field declares
 * that mapping any more (`seoUrlPattern`, removed - see
 * `status/auto-page-collection.md`).
 */

export interface ResolvedDynamicPage {
  pathname: string;
  entryPath: string;
  layoutPaths: string[];
  params: Record<string, string | string[]>;
}

export interface DynamicTemplateResolution {
  template: DynamicPageTemplate;
  /** `null` when the template's own source has no `dry().collection(x).get()`
   * call naming a real slug-enabled collection - the template exists in the
   * pages tree but nothing in it says which rows to enumerate. Surfaced to
   * the caller to show, not silently dropped. */
  type: ContentTypeDefinition | null;
  pages: ResolvedDynamicPage[];
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
async function fetchAllSlugs(dryHttpEndpoint: string, typeName: string, slugLimit?: number): Promise<string[]> {
  const slugs: string[] = [];
  const pageSize = slugLimit !== undefined ? Math.min(500, slugLimit) : 500;
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
    if (slugLimit !== undefined && slugs.length >= slugLimit) return slugs.slice(0, slugLimit);
    if (rows.length < pageSize) break;
  }
  return slugs;
}

export async function resolveDynamicPages(
  templates: DynamicPageTemplate[],
  allTypes: ContentTypeDefinition[],
  /** Keyed by the same storage-root-relative paths `DynamicPageTemplate.
   * entryPath` carries - only each template's OWN entry is read (a layout is
   * shared by every slug, so it can't be what identifies one). */
  sourceByPath: Record<string, string>,
  dryHttpEndpoint: string,
  /** Caps how many rows `fetchAllSlugs` pages through per template - unset
   * (the "Build all" caller) fetches every published row, same as before.
   * `PageEditor.tsx`'s live-preview caller only needs ONE sample entry, so
   * it passes `1` here rather than paginating a whole collection just to
   * preview its first row. */
  slugLimit?: number,
): Promise<DynamicTemplateResolution[]> {
  const resolutions: DynamicTemplateResolution[] = [];
  for (const template of templates) {
    const type = collectionTypeForPageSource(sourceByPath[template.entryPath], allTypes);
    if (!type) {
      resolutions.push({ template, type: null, pages: [] });
      continue;
    }
    const slugs = await fetchAllSlugs(dryHttpEndpoint, type.name, slugLimit);
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
