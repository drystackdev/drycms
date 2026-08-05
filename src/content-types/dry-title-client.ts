/**
 * Client-side `setTitle()` for hydration - `app-router-plugin.ts` injects
 * THIS import (instead of `dry-title.ts`'s SEO-cascade-writing one) into
 * the client build of `src/apps/pages/**`, same split `dry()`/
 * `dry-reader-client.ts` already use. The SSR'd `<title>` tag is already in
 * the DOM by the time hydration re-runs this same page code (hydration
 * doesn't re-render `<head>`), so there's no cascade to write into here -
 * setting `document.title` directly instead keeps this correct for a
 * future client-side navigation too, and is a harmless no-op re-confirmation
 * of the same value during initial hydration.
 */
export function setTitle(title: string): void {
  document.title = title;
}
