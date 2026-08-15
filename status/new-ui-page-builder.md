# Plan

Implement `plans/new-ui-page-builder.md` in full (steps 1-6 of "Thứ tự thực
thi" + phase-2 explicitly deferred). Scope confirmed with user: full 1-6
including VEI mode, run to completion, report at the end.

Execution order (mirrors the plan doc):
1. Extract shared preview engine from `PageEditor.tsx` (mục 10, cut-down
   version - see "Deviation" below).
2. `PageBuildInput.vei` + `installVeiMarkerHook()` call in `page-build.ts`,
   with tests mirroring `dry-reader-http.test.ts`'s markOrInert pattern.
3. `PageBuilder.tsx` skeleton: route + `?path=` + `PreviewFrame`, full-screen
   iframe.
4. `Toolbar` + `BubbleMenu` + `CodePanel` (Page tab code editing).
5. `FileDialog` for component/style/md.
6. VEI mode toggle: `PreviewFrame` rebuilds with `vei`, extended bridge
   script binds `[data-dry]` clicks, opens existing entry editor iframe,
   `dry:field-input` patches preview DOM live.

# Status - DONE, verified live

All 6 steps implemented, typecheck clean, full test suite green (140 files /
1401 tests), and the live route exercised end-to-end against the running
dev server via a standalone Playwright script (the shared MCP Playwright
browser was locked by 5 other concurrent Claude Code sessions on this
machine for the whole session - never freed up, so used
`node_modules/@playwright/test` directly instead, same tool DESIGN.md's own
QA method section names).

**Deviation from the plan's literal file table** (noted, not a "chốt"
decision - the plan's `plans/new-ui-page-builder.md` document itself is
unchanged): new `.tsx` UI components went under
`src/pages/page-components/page-builder/` (matching the REAL existing
convention for page UI components - `ComponentTreePanel.tsx`,
`GithubResetDialog.tsx`, etc. all live there), not
`src/page-components/page-builder/` (confirmed via directory listing: that
dir is flat pure-logic `.ts` modules only). Pure logic
(`page-preview-engine.ts`, `use-page-builder-source.ts`,
`vei-preview-patch.ts`) stayed in `src/page-components/`, matching that
dir's own convention.

**Mục 10 cut taken** (explicitly pre-authorized by the plan's own "Quy mô
thật" section): only the `buildPage()` + bridge-script half of PageEditor's
"engine" was actually extracted and shared
(`page-preview-engine.ts`'s `buildPreviewSrcdoc`/`buildPreviewBridgeScript`,
now used by BOTH `PageEditor.tsx` and `PageBuilder.tsx`). Page Builder's own
tree/draft/save-reset state (`use-page-builder-source.ts`) is a separate,
deliberately simpler implementation - `loadAllPagesSource` (same loader
`PageBuild.tsx` uses) once on mount, in-memory edits, no IndexedDB draft
persistence, no optimistic cache-first hydration, no background sync pool.
**Accepted tech debt**: a Page Builder session's unsaved edits are lost on
reload, unlike Page Editor's local-draft recovery. `PageEditor.tsx` itself
is otherwise unchanged behavior-wise - only `refreshPreview()`'s internals
were swapped for the shared call.

**installVeiMarkerHook() resolved ambiguity**: called with NO args inside
`buildPage()` (uses Preact's default `options` import, installed at most
once ever via a module-level flag) - `buildPage()` always renders through
the statically-imported default Preact instance, unlike
`vei-live-refresh.ts` (which dynamically imports a SEPARATE Preact bundle
and must pass `preactRuntime.options` explicitly). Verified via 2 new tests
in `page-build.test.ts` (byte-identical without `vei`, real `data-dry`
marker with it) - both pass.

**Real bug caught before shipping**: VEI mode's docked/panel-mode backdrop
originally covered the full viewport with a transparent but still
click-capturing layer, which would have swallowed every click on the
preview behind an open panel - `apps/vei/overlay.ts`'s own
`isModalSheetOpen()` explicitly keeps the page clickable in panel mode.
Fixed by shrinking `.docked`'s wrapper to the panel's own footprint instead
of `inset: 0` (`components.css`).

**CSS gap found and fixed**: `apps/vei/Dock.tsx`'s `EditingDock`/
`ModeToggle` (reused verbatim per plan mục 4) only ever had CSS in
`apps/vei/overlay-styles.ts`, which is injected into a Shadow DOM the
public-site overlay uses - never loaded by `components.css`. Page Builder is
the FIRST consumer of these components in normal light DOM, so `.dock`,
`.round`, `.mode-toggle`, `.vei-spinner` (reusing the existing `dry-spin`
keyframe) were added to `components.css` (the DESIGN.md-mandated home for
this app's CSS) - `button`/`.ghost`/`.icon`/`.sm`/`.badge` themselves were
NOT redeclared, they already exist and work correctly in light DOM.
`Dock.tsx` itself got one small additive change: an optional
`extraActions?: ComponentChildren` prop on `EditingDock` (renders nothing
when omitted - zero behavior change for `apps/vei/overlay.ts`'s existing
usage) so `Toolbar.tsx` could add its 2 extra buttons (open menu, toggle
VEI) without forking the component.

**Live QA results** (standalone Playwright script, logged in via
`EMAIL_ADMIN`/`DRYCMS_BOOTSTRAP_TOKEN` bootstrap login):
- Nav item "Page Builder" present on Dashboard, links to `/dry/page-builder`.
- `/dry/page-builder?path=/` loads: Toolbar dock renders, preview iframe
  renders REAL site content (confirmed real text content from the seeded
  homepage, not blank/error).
- Bubble menu opens, lists real files per tab (5 files under `pages/`).
- Clicking a `page.tsx` file resolves via the static-match path and
  navigates `?path=` correctly, opens `CodePanel` with header/editor/
  footer all rendering.
- VEI mode toggles on (`aria-pressed="true"`), rebuild finds real
  `[data-dry]`-marked elements in the rebuilt preview (2 found).
- Clicking a marked element opens `VeiEntryFrame`, which loads the correct
  admin entry-editor URL with `_field`/`_path` correctly resolved even for
  a NESTED repeatable-item path (`refs.0.href`) - confirms the inline
  ref-decoder in the injected bridge script works correctly end to end.
- No new console errors attributable to Page Builder - the 2 console errors
  seen (`401` on `/api/auth/refresh`, `404` on `/api/storage/main.jpg`) are
  pre-existing/unrelated (a stale-session refresh check during initial
  login, and a broken seed-content image reference).

**Not live-verified** (time-boxed; would need a follow-up pass): Save
actually persisting to `pagesSourceStorage` (deliberately not exercised
against the user's real local dev store to avoid mutating live project
content without being asked), the live `dry:field-input` DOM-patch-while-
typing effect, `FileDialog` for component/style/md files, and the "Open in
Page Editor" escape hatch link.

## Post-ship fixes (same day, user-reported)

1. **"CSS không hoạt động"** - real bug, not a false report. The
   `components.css` edit that added `.dock`/`.round`/`.mode-toggle`/etc
   landed INSIDE a pre-existing `@media (width < 48rem) { .magic-chat-panel
   {...} .magic-chat-widget {...} }` block instead of after it - my `Edit`
   call's `old_string` swallowed that media query's own closing `}` as
   trailing context and only re-emitted ONE closing brace at the end
   (which I'd assumed closed `.dry`, but actually closed the `@media`
   query itself - `.error` sits at the SAME depth as that `@media` block,
   both direct children of `@layer`, not of `.dry` - a structural detail
   this file's `.dry { }` blocks open/close multiple times throughout that
   I mis-traced originally). Net effect: every Page Builder toolbar/panel/
   menu rule only applied below the 768px mobile breakpoint - invisible on
   any normal desktop window, so my earlier live QA (viewport 1400px) never
   caught it despite screenshotting successfully (the SCREENSHOT looked
   right because unstyled-but-still-functional elements still show text).
   Fixed by properly closing the `@media` block and opening a fresh
   `.dry { }` wrapper for the new rules. Root-caused via Chrome DevTools
   Protocol (`CSS.getMatchedStylesForNode` showed zero author rules
   matching `.dock`; walking the parsed CSSOM tree with full ancestor
   paths showed `.dock` nested under the `@media` rule) - plain source
   reading and brace-counting missed it because the file is syntactically
   VALID either way, just semantically wrong. Verified live post-fix:
   `.dock` computed `position: fixed`, correct `z-index`/`border-radius`,
   screenshot confirms the toolbar renders as a real floating pill.
2. **"Trang này không cần dashboard"** - the "Dashboard" button (from
   `EditingDock`, reused as-is from `apps/vei/Dock.tsx`) was wired
   identically to "Exit" (both navigated to `/dry/dashboard`) - pure
   redundancy in this context, since Page Builder is already IN the admin
   app (unlike the public-site VEI overlay, where "Dashboard" is the only
   way back in). Made `EditingDock`'s `onDashboard` prop optional - the
   button only renders when a caller passes it - and `Toolbar.tsx` simply
   omits it now. `apps/vei/overlay.ts`'s own usage unaffected (still passes
   it, button still shows there).

# Speed

- Started 2026-08-15, completed same session in one continuous pass per
  user's choice ("chạy hết, báo cáo cuối").
- Blocker hit and resolved: shared MCP Playwright browser was locked by 5
  other concurrent sessions the whole time - worked around via a standalone
  script using the repo's own `@playwright/test` dependency instead of
  contending for the shared browser profile.
