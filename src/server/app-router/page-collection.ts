import type { ContentTypeDefinition } from "../../content-types/types.js";

/**
 * `dry().collection("<name>").get(` - the ONE call a `[param]` page must
 * make to render its own entry (`dry-reader.ts`'s `DryCollectionReader.
 * get`). `\s*` everywhere because the real call is usually wrapped across
 * lines by the formatter; the closing `(` of `.get` is part of the match so
 * a `.list(` call (a page listing a collection it does NOT get its own
 * identity from - e.g. a sidebar of related posts) never counts.
 */
const COLLECTION_GET = /\bdry\s*\(\s*\)\s*\.\s*collection\s*\(\s*["'`]([A-Za-z0-9_$]+)["'`]\s*\)\s*\.\s*get\s*\(/g;

/**
 * Which `collection` a dynamic (`[param]`) page renders one entry of, read
 * straight off the page's OWN source - the replacement for the removed
 * `seoUrlPattern` config field (`status/auto-page-collection.md`).
 *
 * A dynamic page has no way to render without fetching its entry by the
 * route param, and the only way to do that is `dry().collection(x).get(...)`,
 * so that call already IS the route->collection mapping this codebase used
 * to ask an admin to re-declare by hand in the schema editor. Reading it
 * here means the mapping can never drift from the code (renaming a route
 * folder or switching a page to another collection needs no second edit),
 * and a route with no page file can no longer end up advertised in
 * `sitemap.xml`.
 *
 * The FIRST match that resolves to a real `collection` with `features.slug`
 * wins - a page may well read other collections too (`dry().collection(
 * "setting").get("main")` for a header), but its own entry is fetched
 * first, at the top of the component, before anything can render.
 *
 * Deliberately a scan, not a parse: `sourceByPath` here is raw TSX and the
 * one shape that matters is fixed by the `dry()` API itself. The cost is
 * that indirection (`const c = dry().collection(x); c.get(slug)`) and a
 * commented-out call read wrong - both surface immediately as an
 * unresolved template in Page Builder / the Page Editor preview rather
 * than silently building the wrong pages.
 */
export function collectionTypeForPageSource(
  source: string | undefined,
  allTypes: ContentTypeDefinition[],
): ContentTypeDefinition | null {
  if (!source) return null;
  COLLECTION_GET.lastIndex = 0;
  for (let match = COLLECTION_GET.exec(source); match; match = COLLECTION_GET.exec(source)) {
    const type = allTypes.find((t) => t.name === match![1] && t.kind === "collection" && t.features?.slug === true);
    if (type) return type;
  }
  return null;
}
