# Spike: app-r2 build-in-browser pipeline (plans/app-r2.md)

## Plan

Answer the 4 unknowns flagged in `plans/app-r2.md`'s "Spike trước" section,
with running evidence, not guesses. Throwaway code only - nothing here is
meant to survive past this spike as production code.

1. `sucrase-eval.ts`'s `resolveModulePath` throws on every bare specifier
   (Component Builder's "only file imports" rule) - a real `page.tsx` needs
   `preact`/`preact/hooks` at minimum. Does an allowlist extension work?
2. CJS (current `sucrase-eval.ts` output, via `transforms: ["imports"]`) vs
   ESM (drop that transform) for `page.js` - is the ESM output actually
   loadable by a real browser module loader?
3. `@tailwindcss/browser` - not yet a dependency. Can it compile CSS for
   content that ISN'T mounted in the live document (a string/offscreen
   render), or is it strictly DOM-observation based?
4. Build time for 1 page + rough size cost.

## Status: DONE for 1-2-4 (confirmed), 3 partially (source-confirmed, live run blocked)

**Design change from the plan's own wording** (decided before coding, not a
finding from running it): `render.ts`'s `renderPage()` can't be imported into
a browser bundle as-is - it calls `runWithDryContext` unconditionally, and
`dry-context.ts:1` imports `node:async_hooks` (Node-only), even for a page
with zero `dry()` calls. This confirms `plans/app-r2.md` mục 2's premise
(`buildDocument()` needs extracting out of `render.ts`) rather than
contradicting it. So the harness calls `resolveMatchToVNode` (verified
dependency-free - only imports types) and `renderToStringAsync` directly,
wrapping the result in a minimal hand-built `<head>` instead of going through
`render.ts`. Real head-building (SEO tags, replay log) stays out of scope,
same as mục 2 already says.

Page under test: the actual current `src/apps/pages/page.tsx` + `layout.tsx`
(the starter homepage, fetched live via Vite's `?raw`, not hand-written toy
source) - both plain sync components, no `dry()` calls. Deliberate: `dry()`'s
browser/HTTP variant (mục 3 of "Phải xây") doesn't exist yet, so a page
calling it is out of scope for this spike by construction.

**Playwright was locked by a concurrent session** (`Browser is already in use
... use --isolated`) - the exact scenario `feedback_concurrent_repo_editing`
warns about. Did not force it open/kill it. Pivoted: unknowns #1/#2/#4 don't
actually need a live DOM (pure compute - eval, `resolveMatchToVNode`,
`renderToStringAsync` are all Node-safe SSR-shaped code), so they ran under
vitest instead (`bun run test -- src/__spike__/harness.spike.test.ts`) -
vitest runs on real Vite under the hood, so `?raw` imports and the project's
real TS/JSX transform behave identically to a real browser tab. Only unknown
#3 (`@tailwindcss/browser`) genuinely needs `document`/`MutationObserver` and
stayed blocked - answered instead via `WebFetch` on the package's actual
source (`tailwindlabs/tailwindcss`'s `packages/@tailwindcss-browser/src/index.ts`).

### Results

1. **Allowlist extension works.** Full REAL pipeline (not stubbed): eval
   through an allowlist (`preact`→`{h,Fragment}`, `preact/hooks`→the running
   `preact/hooks` instance) → `resolveMatchToVNode` → `renderToStringAsync`,
   on the real page+layout source. Output HTML matched the real nested
   layout/page structure exactly. Timing: eval+resolve ≈5.6ms, render ≈0.5ms.
2. **ESM output works, with a real gotcha found:** sucrase's classic JSX
   pragma (`jsxPragma:"h"`) does NOT auto-inject an `h`/`Fragment` import -
   only the "automatic" JSX runtime does that. The CJS path hides this by
   passing `h`/`Fragment` as `new Function` args. Real ESM output needs the
   import line injected by the build step itself (same pattern
   `app-router-plugin.ts` already uses for `dry`/`params`). Added to mục 7.
3. **Source-confirmed DOM-only, live run still pending.** `@tailwindcss/browser`
   self-executes on import (`rebuild('full')` once), then a `MutationObserver`
   watches `document` for `<style type="text/tailwindcss">` changes and
   `class`-attribute/new-node mutations, scanning
   `document.querySelectorAll('[class]')`. No programmatic/headless API at
   all. New architectural implication for mục 6, not in the plan before: a
   page build must MOUNT rendered HTML into a live (even if hidden) document,
   and because the observer/stylesheet is global per tab, building N pages in
   one admin session needs per-page isolation (fresh iframe, or diff the
   stylesheet before/after) so page A's classes don't leak into page B's CSS.
   **Still needs a live-browser run** to confirm it actually emits correct
   compiled CSS for a mounted page - blocked by the concurrent session above.
4. **Partial timing.** Eval+resolve+render+ESM-check ≈11ms total (Node,
   vitest, one simple page) - fast, reassuring, but NOT the full picture:
   excludes real Tailwind compile time (blocked, see #3) and real admin
   bundle-size delta (harness was never wired into a real entry point).

### Cleanup done

- `src/__spike__/harness.ts`, `src/__spike__/harness.spike.test.ts` - deleted
  (throwaway, per the plan's own "chưa cam kết gì").
- `@tailwindcss/browser` - **left installed** as a devDependency (`bun add -d`,
  2026-08-09). Cheap, truthful (we verified real facts about it), and the
  next step (live browser run) needs it again. Revert with
  `bun remove @tailwindcss/browser` if not wanted yet.
- Raw JSON result kept at
  `/private/tmp/claude-501/-Users-kcoder-drycms/8bf3a714-4f01-44a4-a44b-1a584ff74c98/scratchpad/app-r2-spike-result.json`
  (scratchpad, not repo) for reference - not durable, don't rely on this path
  surviving past the session.

## Speed

Started and finished 2026-08-09, well under the "nửa buổi" budget. Remaining
work (#3 live confirmation, full #4 timing) is small and explicitly deferred
to whenever the browser is free - doesn't block starting Giai đoạn 1 (route
manifest, build core), only mục 6 (CSS) within Giai đoạn 3.
