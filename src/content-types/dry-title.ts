import { tryGetDryContext } from "./dry-context.js";

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
 * A no-op outside a real render (no bound context at all - e.g.
 * `render.ts`'s `renderErrorHtml`, which renders `404.tsx`/`500.tsx` without
 * ever calling `runWithDryContext`) or one whose context never wired `seo`
 * in (e.g. a unit test that only needs `entries`/`allTypes`) - unlike
 * `dry()` itself (`dry-reader.ts`, which still hard-fails via
 * `getDryContext`), a page's title is never essential to a render
 * succeeding.
 */
export function setTitle(title: string): void {
  const context = tryGetDryContext();
  if (!context?.seo) return;
  context.seo.page = { ...context.seo.page, metaTitle: title };
}
