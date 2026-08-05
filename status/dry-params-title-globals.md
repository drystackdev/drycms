# Ambient globals: `params()` and `setTitle()`

## Plan

Two asks:
1. `params` callable as an ambient global from anywhere in `src/apps/pages/**`
   (helper functions, not just the top-level page/layout component), mirroring
   `dry()`. `plans/app-router.md` (128-133) previously rejected a `Dry.params`
   global specifically because a naive plain-object global would leak between
   concurrently in-flight renders - the same reasoning `dry-context.ts`
   already solved for `dry()` via `AsyncLocalStorage`. Reusing that exact ALS
   context resolves the original objection, so implementing it now doesn't
   reintroduce the bug that killed the idea the first time.
2. A way to set the rendered document's `<title>` directly from a page,
   without needing a whole content-type's `seo` component field - `setTitle()`,
   plugged into the EXISTING SEO cascade (`dry-seo.ts`) as a new highest-
   priority `page` tier, so it reuses `render.ts`'s existing `<title>`-emitting
   code path rather than adding a second one.

Design (mirrors `dry()`'s own server/client split exactly):
- `dry-context.ts`: `DryRequestContext` gains `params?: Record<string, string
  | string[]>` (matches `RouteMatch.params`'s real type).
- `params-reader.ts` (server, new) / `params-reader-client.ts` (client, new,
  plain module var - browser is single-threaded, no ALS needed) - `params()`.
- `dry-seo.ts`: `DrySeoLayers` gains `page?: DrySeoValue`, applied with
  highest priority (above `entry`) in `mergeSeoLayers`.
- `dry-title.ts` (server, new) / `dry-title-client.ts` (client, new, also
  sets `document.title` directly for correctness) - `setTitle(title)`.
- `app-router-plugin.ts`: generalize its single-global (`dry`) regex-inject
  transform into a small data-driven table covering `dry`/`params`/`setTitle`,
  each resolving to its server or client module depending on
  `this.environment.config.consumer`.
- `page-handler.ts`: seed `dryContext.params = match.params`.
- `hydrate-client.ts`: seed the client's module-level params from its own
  `matchRoute()` call before resolving the vnode tree.

Known caveat (documented in `params-reader.ts`'s own doc comment, not
silently hidden): a page/layout that destructures `{ params }` as its OWN
prop AND calls the global `params()` inside that SAME function will shadow
the import with the local prop and throw ("params is not a function") - use
one or the other per function, not both.

## Status

Done. Both globals work end-to-end, verified in a real browser request.

Landed:
- `dry-context.ts`: `DryRequestContext.params?` (optional, same self-healing
  idiom as `touchedTypes`/`callLog`/`seo`).
- `params-reader.ts` (server, ALS-backed) + `params-reader-client.ts`
  (client, module var + `setCurrentParams`).
- `dry-seo.ts`: new `page` layer, highest priority in `mergeSeoLayers`
  (Default < Singleton < Entry < Page).
- `dry-title.ts` (server, writes `seo.page`) + `dry-title-client.ts`
  (client, sets `document.title`).
- `app-router-plugin.ts`: the single hardcoded `dry` inject became a
  data-driven `AMBIENT_GLOBALS` table (`dry`/`params`/`setTitle`), each with
  its own call/import regex + server/client module pair. A file using
  several gets one injected import line per global actually called.
- `page-handler.ts` seeds `params: match.params`; `hydrate-client.ts` calls
  `setCurrentParams(match.params)`.
- `codegen.ts`: `declare global` now also declares `params()`/`setTitle()`;
  header comment updated. `dry.generated.d.ts` regenerated.

Tests (760 total, all pass; typecheck clean):
- `app-router-plugin.test.ts` +4: params inject (server+client), setTitle
  inject (server+client), multi-global file, already-imported skip.
- `params-reader.test.ts` (new) 9: params basics, catch-all array, `{}`
  default, throws outside a render, **concurrent-render isolation** (the
  exact bug the original `Dry.params` idea would have had), setTitle
  layer write / last-wins / no-op without seo / leaves other layers alone.
- `dry-seo.test.ts` +1: page layer overrides entry.

Live verification: built a throwaway `_globals-check/[check]/page.tsx` whose
helper function reads `params()` with NO prop threaded in and calls
`setTitle()`; `GET /_globals-check/hello-world` returned
`<title>Globals check: hello-world</title>` and `<p
id="slug-from-helper">hello-world</p>`. Confirmed the client build injects
the `-client` modules (checked the transformed module Vite serves). Throwaway
page deleted; all 5 real site pages re-checked at 200.

Caveat (documented in `params-reader.ts`'s doc comment): a function that both
destructures its own `params` prop AND calls the `params()` global shadows
the import - the existing `blogs/[slug]/page.tsx` does exactly this, which is
fine (it uses the prop), but it can't also call the global inside that same
function.

## Speed

Scoped directly (single session), no blocking ambiguity - implemented,
tested, browser-verified in one pass.
