import type { DrySeoValue } from "./dry-seo.js";

/**
 * `setTitle()`'s THIRD variant, for the same reason `dry()` needed one
 * (`dry-reader-http.ts`'s doc comment) - and NOT interchangeable with
 * `dry-title-client.ts`'s hydration variant, which is a correctness trap
 * here specifically: that one writes straight to `document.title` because
 * "the SSR'd `<title>` tag is already in the DOM by the time hydration
 * re-runs this code" (its own doc comment) - true for hydration, false for
 * a build, which has no existing `<title>` yet and needs `setTitle()` to
 * feed the SAME `seo.page` cascade tier the real server `dry-title.ts`
 * writes into (`getDryContext().seo.page.metaTitle`) so
 * `build-document.ts`'s `buildSeoTags` picks it up. Using the hydration
 * variant here would silently drop every `setTitle()` call from the built
 * page's `<title>`.
 */
let page: DrySeoValue | undefined;

/** Call once per page build, before evaluating page/layout code - clears
 * any previous build's title so a page that DOESN'T call `setTitle()`
 * doesn't inherit the last page's. */
export function resetHttpTitle(): void {
  page = undefined;
}

/** Reads back what this build's `setTitle()` calls accumulated - the
 * orchestrator folds this into `BuildDocumentContext.seo.page` after
 * rendering finishes (same last-write-wins single field the real
 * `dry-title.ts` exposes, `metaTitle` only). */
export function readHttpTitleLayer(): DrySeoValue | undefined {
  return page;
}

export function setTitle(title: string): void {
  page = { ...page, metaTitle: title };
}
