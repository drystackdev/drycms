/**
 * Client-side `params()` for hydration - `app-router-plugin.ts` injects
 * THIS import (instead of `params-reader.ts`'s `AsyncLocalStorage`-backed
 * one) into the client build of `src/apps/pages/**`, same split `dry()`/
 * `dry-reader-client.ts` already use. No `AsyncLocalStorage` needed here
 * (unlike the server side) - a browser page only ever hydrates once at a
 * time, so a plain module-level variable is enough, same reasoning
 * `dry-reader-client.ts`'s own doc comment gives.
 */
let currentParams: Record<string, string | string[]> = {};

/** Called once by `hydrate-client.ts`, before resolving the page/layout
 * tree, with the SAME `match.params` it derived from `window.location.pathname`. */
export function setCurrentParams(value: Record<string, string | string[]>): void {
  currentParams = value;
}

export function params(): Record<string, string | string[]> {
  return currentParams;
}
