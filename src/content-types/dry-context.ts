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
/** 1 recorded `dry()` call result, in call order - see `dry-replay-codec.ts`
 * and `dry-reader-client.ts`. Client hydration can't call `dry()` for real
 * (no `AsyncLocalStorage`/DB access in the browser), so it replays
 * `page.tsx`/`layout.tsx` against these already-fetched results instead -
 * matched purely by POSITION (the client re-runs the exact same code path
 * in the exact same order), not by `kind`/`name`/`method`, which exist only
 * for a dev-time mismatch warning. */
export interface DryCallLogEntry {
  kind: "collection" | "singleton";
  name: string;
  method: "get" | "list";
  result: unknown;
}

export interface DryRequestContext {
  entries: ContentEntryEngineAdapter;
  allTypes: ContentTypeDefinition[];
  /** Content type names read during this render - `dry-reader.ts`'s
   * reader functions add to this as they go. Optional (not every caller
   * needs it, e.g. `dry-reader.test.ts`'s existing cases) so an omitted
   * value degrades to "don't track" instead of forcing every call site to
   * pass one - same self-healing-optional-field idiom as
   * `ContentTypeDefinition.fieldOrder` etc. (see `docs/ARCHITECTURE.md`).
   * `plans/app-router.md`'s `page-handler.ts` populates this to know which
   * `getResourceVersion()`s a cached render needs to re-check. */
  touchedTypes?: Set<string>;
  /** Every `dry()` call's result, in order - optional same as `touchedTypes`
   * above. `page-handler.ts` populates this so `render.ts` can embed it for
   * `hydrate-client.ts` to replay (`plans/app-router.md`'s Giai đoạn 2). */
  callLog?: DryCallLogEntry[];
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
