# Plan

Implement `plans/code-editer.md`: a standalone `Editer` component (TSX/Preact
code editor built on `prism-code-editor`) with real TS diagnostics/completion
(via `ts.createLanguageService` in a Web Worker + virtual FS) and Tailwind v4
class-list suggestion (via `tailwindcss`'s `__unstable__loadDesignSystem`).
Shadow-DOM mounted (`prism-code-editor/setups`'s `basicEditor` does this
itself). Standalone demo page/route, not linked from Showcase.

# Status

Done. All files under `src/components/Editer/` + thin re-export at
`src/components/Editer.tsx` + `src/pages/CodeEditerDemo.tsx` + route in
`src/routers/App.tsx`.

- Deps: `prism-code-editor`, `tailwindcss` v4 (`@tailwindcss/browser`
  installed then removed - wrong tool, see plan mục 4 revision history).
- `ts-worker.ts`: `ts.createLanguageService` in a Web Worker, virtual FS
  seeded from real `typescript/lib/lib.*.d.ts` (glob `?raw`) + preact's own
  `.d.ts` files (flattened, bare-specifier resolution for `preact`/
  `preact/hooks`/`preact/jsx-runtime`) + `extraFiles`. Syntax diagnostics
  always computed; semantic diagnostics computed but never block `success`.
- `tailwind-completions.ts`: `tailwindcss`'s `__unstable__loadDesignSystem`
  (needs a hand-written `loadStylesheet` - confirmed `tailwindcss/index.css`
  has no nested `@import`s, so it's a single static return) -
  `getClassList()` feeds a plain prefix-filter `CompletionSource`.
- `Editer.tsx`: `prism-code-editor/setups`'s `basicEditor` (shadow-mounts
  itself). Bridges the worker's async completions onto the autocomplete
  extension's synchronous `CompletionSource` contract via a per-position
  cache + forced re-query on resolve.
- Verified against a real browser (isolated e2e server on :4173, separate
  from the live :5173 dev server) via Playwright, not just typecheck:
  syntax errors surfaced live, both completion sources show real popups
  (Tailwind classes filtered by prefix, TS/DOM members for `document.`).
- `bun run typecheck`, `bun run test` (591 tests, no regressions), and
  `bun run build` (client + SSR) all pass. Worker chunk is ~6.5MB
  (typescript + all lib.d.ts + preact types) - lazy, only loaded when an
  Editer mounts; accepted cost per plan mục 1's engine tradeoff.

Bugs found and fixed only by driving it in a real browser (not visible from
typecheck/unit tests):
- Stale-echo race: the worker's diagnostics response could arrive after the
  user had typed further, and blindly syncing `value` back into the editor
  reverted those newer keystrokes. Fixed by tracking the last code we
  reported and skipping re-sync when the incoming prop is just our own echo.
- Infinite loop: the completion bridge's "re-query once the async result
  lands" called `startQuery()` unconditionally, which re-ran the same
  source, which re-fired the same async request, forever - froze the tab.
  Fixed by only firing a request when a position has no cached entry yet.
- Autocomplete popups rendered with ~0 height (present in the DOM, provably
  populated, just visually collapsed): `.prism-code-editor` has no explicit
  height in the library's own CSS (content-sized by default), so the "full
  panel" host div never actually got filled, and the tooltip's own
  max-height calc (derived from the editor's `clientHeight`) inherited that
  same near-zero size. Fixed with one CSS override injected into the shadow
  root.

# Speed

Completed 2026-08-04, same session as the plan discussion.
