import { AsyncLocalStorage } from "node:async_hooks";
import type { ContentEntryEngineAdapter } from "./engine/entries-types.js";
import type { ContentTypeDefinition } from "./types.js";

/**
 * What `dry()` (see `dry-reader.ts`) needs to answer a query, bound to
 * whichever request/render is currently in flight - `AsyncLocalStorage`
 * rather than a module-level variable because a page render is async and
 * multiple renders can be in flight concurrently (see `plans/reader.md`'s
 * critique of `plans/app-router.md`'s `Dry.params` sketch, which has this
 * exact bug). Unlike `node:fs` (used by nothing here), `AsyncLocalStorage` is
 * supported on Cloudflare Workers too, so this stays usable if `dry()` is
 * ever called from a Workers-deployed render, not just Node.
 */
export interface DryRequestContext {
  entries: ContentEntryEngineAdapter;
  allTypes: ContentTypeDefinition[];
}

const storage = new AsyncLocalStorage<DryRequestContext>();

/** Runs `fn` with `context` bound for the duration of the call (and anything
 * it awaits transitively) - every `dry()` call inside sees this same
 * context. Call once per page render/request, wrapping the whole render. */
export async function runWithDryContext<T>(context: DryRequestContext, fn: () => T | Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

/** Throws (rather than returning `null`/`undefined`) when called outside
 * `runWithDryContext` - a page that calls `dry()` without ever being rendered
 * through the reader's own entry point is a caller bug, not a state worth
 * silently tolerating. */
export function getDryContext(): DryRequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error("[drycms] dry() was called outside a request - render must go through runWithDryContext().");
  }
  return context;
}
