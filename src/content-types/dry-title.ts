import { getDryContext } from "./dry-context.js";

/**
 * Sets this page's `<title>` (and `og:title`) directly - writes into the
 * SEO cascade's highest-priority `page` layer (`dry-seo.ts`'s
 * `mergeSeoLayers`), above even a collection entry's own `features.seo`
 * field. For a page whose title isn't driven by a content entry at all (a
 * static page, or one that wants to compose the title from data already in
 * hand rather than a dedicated `seo` component field).
 *
 * Ambient global (like `dry()`/`params()`) - call from anywhere in a page/
 * layout's render, any number of times; the last call wins, same
 * last-write-wins semantics a plain component-scoped variable would have.
 * A no-op outside a real render whose context never wired `seo` in (e.g. a
 * unit test that only needs `entries`/`allTypes`) - same
 * degrade-to-no-op idiom `dry-reader.ts`'s `recordSeoLayer` already uses.
 */
export function setTitle(title: string): void {
  const context = getDryContext();
  if (!context.seo) return;
  context.seo.page = { ...context.seo.page, metaTitle: title };
}
