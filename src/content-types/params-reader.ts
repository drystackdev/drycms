import { getDryContext } from "./dry-context.js";

/**
 * The current route's dynamic segments (`[slug]` -> `string`, `[...path]` ->
 * `string[]`) - the same value `resolve-match.ts` already passes every page/
 * layout component as its `params` prop, exposed here as an ambient global
 * (like `dry()`) so a helper function that ISN'T the top-level page/layout
 * component can read it without the prop being threaded through every call.
 * Bound via the SAME per-render `AsyncLocalStorage` `dry()` uses
 * (`dry-context.ts`) - safe under concurrent renders for the same reason
 * `dry()` is (see that module's doc comment, which also covers why
 * `plans/app-router.md`'s original `Dry.params` sketch - a plain mutable
 * global - was rejected: this isn't that, it's request-scoped).
 *
 * `{}` (not a throw) when nothing was seeded - e.g. most of
 * `dry-reader.test.ts`'s cases, which build a `DryRequestContext` with no
 * real route match at all.
 *
 * CAVEAT: a page/layout that destructures its own `params` PROP (the
 * existing, still-supported convention) and ALSO calls this global
 * `params()` inside that SAME function will have the local prop shadow the
 * imported function - the call throws ("params is not a function"), same
 * as any other JS name collision. Use the prop or this global within a
 * given function, not both.
 */
export function params(): Record<string, string | string[]> {
  return getDryContext().params ?? {};
}
