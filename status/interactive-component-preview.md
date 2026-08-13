# Interactive Page Editor / Component preview

## Plan

Page Editor's live preview (`refreshPreview` in `PageEditor.tsx`) has always
rendered through the real `buildPage()` pipeline but stripped hydration
entirely before assigning `iframe.srcdoc` - a static SSR-only render, no
component JS ever ran (documented as a deliberate follow-up, not a bug, at
the old code's own comment). Triggered by a user pasting a `ThemeToggle`
component (`document`/`window`/`localStorage`/`matchMedia` in `useEffect`/
`onClick`) and asking why it wouldn't work in preview - confirmed the real
cause was "hydration never runs here at all", not a document/window binding
mistake, and the user asked to implement the deferred follow-up: make the
preview iframe actually hydrate.

Approach: stop skipping `jsAssets` compilation (`skipJsAssets: true` →
removed), then remap every compiled asset's real `/api/built-assets/...` URL
to a `Blob` object URL (holding the just-compiled, unpublished source) via a
`<script type="importmap">` injected into the iframe's own `<head>` -
avoids the exact footgun the old code's stripped-manifest approach was
sidestepping (hydrating against a stale PUBLISHED build instead of the
current in-browser edit).

## Status: DONE, verified live

- `page-build.ts`: exported `builtAssetUrlForJsPath` (the encode/join half of
  the existing private `toBuiltAssetUrl`) so `PageEditor.tsx` can compute the
  exact same asset URL string from a `jsAssets` entry's `jsPath` alone.
- `PageEditor.tsx`'s `refreshPreview()`: builds an import map (asset URL →
  blob URL) instead of stripping the hydrate manifest; keeps the manifest/
  params scripts; blob URLs tracked in `previewBlobUrlsRef`, revoked one
  cycle later (after the next srcdoc replaces the old document) and on
  unmount.
- Two real, non-obvious traps found only by testing live (not from reading
  the spec) and fixed:
  1. `bun run dev` serves `hydrate-built.ts` as a raw Vite-dev-transformed
     module (not a prebuilt bundle); Vite's dev import-analysis pass wraps
     EVERY dynamic `import()` - even `/* @vite-ignore */` ones - in its own
     `__vite__injectQuery(url, "import")`, appending a literal `?import` to
     the URL actually passed to native `import()`. Fixed by adding a second
     import-map entry per asset with `?import` appended, same blob target.
  2. A module loaded from a `blob:` URL has a non-hierarchical base - the
     browser can't resolve a root-relative specifier (`/dry/api/...`)
     against it at all (fails before ever consulting the import map, so a
     matching entry doesn't help). Fixed by making `builtAssetsBaseUrl` and
     `preactRuntimeHref` origin-QUALIFIED for this preview build call only
     (real publish paths untouched, still root-relative - correct there,
     since a real visitor's page is never loaded from `blob:`).
- Verified live via a standalone Playwright script (not part of the e2e
  suite - the shared interactive Playwright browser was locked by another
  concurrent session, so this used its own throwaway `chromium.launch()`
  against the running `bun run dev` server instead): a temporary
  `ThemeToggle`-shaped test component's button click, inside the preview
  iframe, actually flips `document.documentElement.classList` AND
  `localStorage` - both scoped to the IFRAME's own document, confirmed by
  checking the admin tab's own `<html>` class stayed untouched. A real
  `pages/page.tsx` preview still renders + hydrates with 0 new console
  errors. Full existing `page-build.test.ts` (10) + `pages-build.test.ts`
  (14) suites still pass; `tsc --noEmit` clean.
- **Known gap, documented in code, not fixed**: `about:srcdoc` has no origin
  of its own, so `localStorage`/`sessionStorage`/cookies are the SAME
  storage as the admin tab (not isolated per preview) - confirmed live, the
  test `ThemeToggle`'s `dry-theme` key leaked into the admin's own
  `localStorage` (its DOM class did NOT leak - only storage). Real fix would
  need a cross-origin-sandboxed iframe, which breaks `blob:` URL access
  (same-origin only) - out of scope for this pass.

## Speed

Single session, done in one pass after 2 rounds of live-Playwright-driven
debugging (the two traps above). No follow-up planned unless the storage-
isolation gap above turns out to matter in practice.
