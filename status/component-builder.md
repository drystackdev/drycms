# Component Builder

## Plan

See `plans/component-builder.md` for the full design. Summary:

- New storage root `.dry/components` (`DryOption.pageComponents.storage`,
  same `StorageAdapter` mechanism as `icons`/`storage`), separate from the
  existing `components.storage` (RichText bundling).
- Server CRUD routes for a file/folder tree of `.tsx` components, gated by
  session + a new synthetic Role-editor permission resource ("Page
  Components", `setting` action) - following the existing `PERMISSION_RESOURCE`
  pattern in `RoleEditor.tsx`, not a second permission table.
- Client page: left folder tree, top preview pane (Mobile 375 / Tablet 768 /
  Desktop 1280 + resize), bottom `Editer` (reused as-is, `extraFiles` = other
  tree files for cross-file TS references/import restriction).
- Runtime transform for the preview: `sucrase` (`jsx`+`typescript` presets)
  + `new Function(...)` eval, same shape as `EditableDemo.tsx`'s
  `@babel/standalone` path but a separate, lighter mechanism per the plan.

## Status

Done, implemented and QA'd end-to-end (2026-08-04):

- `DryOption.pageComponents` (default root `.dry/components`) wired through
  `options.ts`/`config.ts`/`dry.config.ts` (E2E block)/`.gitignore`.
- `src/server/routes/page-components.ts` - full tree CRUD (`?tree`,
  folder/file GET, mkdir, PUT create-or-overwrite, PATCH move/rename,
  DELETE), `.tsx`/`.ts`-only extension guard. Registered in `handler.ts`.
- Permission: `admin-access.ts`'s new `requirePermission()` + a synthetic
  `PAGE_COMPONENTS_RESOURCE` (`system-page-components`, singleton-shaped,
  `setting` action) added to `RoleEditor.tsx`'s singletons list and gated
  in `handler.ts` for every method (no separate view permission). Nav item
  in `DryLayout.tsx` uses a new `permissionResourceId` field (direct
  `canAccess` check, since this resource has no real `ContentTypeDefinition`
  row for `permissionName`'s content-type lookup to find).
- Client: `src/page-components/http-api.ts` (fetch glue), `tree.ts` (flat
  entries -> nested tree), `sucrase-eval.ts` (Sucrase `jsx+typescript+imports`
  transform + a tiny CommonJS-shaped `require()` resolving only relative
  imports within the tree - satisfies "only file imports", memoized per
  render so a shared import evaluates once).
- `src/pages/PageComponents.tsx` + `page-components/ComponentPreview.tsx` -
  left folder tree (create file/folder via path-accepting text inputs,
  delete w/ `ConfirmDialog`), preview pane (Mobile 375/Tablet 768/Desktop
  1280 + +/-/Reset, `zoom`-based auto-scale-to-fit), `Editer` reused as-is
  (`extraFiles` = other tree files). New CSS added inside `.dry{}` in
  `components.css` (had to trace the file's actual brace nesting first -
  most of it is one long `@layer dry.components { .dry { ... } }`, but a
  tail section of sibling rules like `.error`/`@keyframes` sits *outside*
  `.dry{}`, same `@layer` level - easy to misplace new rules there).
- Tests: `page-components.test.ts` (13 cases) + updated `options.test.ts`.
  `bun run typecheck` clean, full suite 657/657 passing.
- Browser QA: minted a real session (via the app's own `createAuthSession`/
  `signSession`, not a hand-forged token - `resolveSession` requires a live
  KV session record, not just a valid JWT) for the existing Super Admin dev
  account, drove it with a throwaway Playwright script (no `chromium-cli`
  available). Required a dev-server restart mid-QA - `server/config.ts`
  caches `resolveOptions()` at module scope, so the new route/option
  weren't live until restart (per `CODING-PRINCIPLES.md`'s concurrent-edit
  note). Verified: nav item + permission gate, create/edit/preview/save/
  reload-persistence, Mobile/Tablet/Desktop + resize, nested folder
  creation, delete w/ confirm - all working, zero console errors. One
  Playwright-only gotcha hit and fixed: `.type()` char-by-char collided
  with the editor's JSX auto-close-tag feature and duplicated `</div>` -
  `keyboard.insertText()` (one atomic input event) fixed it; not a product
  bug. QA session revoked and the throwaway test component cleaned up from
  the live store afterward.

## Update 2026-08-04 (v2): VS Code-style shell redesign

User asked for a shadcn `sidebar-11`-style tree, flush VS Code-style
resizable panels, search, add-file/add-folder buttons, sidebar collapse,
right-click context menu (rename/delete), and drag-and-drop move that keeps
relative imports correct - plus (mid-turn) a full-bleed shell (no card, no
page header text) and a segmented `.button-group` for the device picker.

- `src/lib/useResizablePanel.ts` - generic single-divider drag-resize hook
  (width or height), reused for the sidebar and the preview/editor split.
- `src/page-components/import-rewrite.ts` - regex-based (not AST) rewrite of
  relative `from "..."` specifiers after a move: the moved file's own
  imports get recomputed for its new directory, and every other file that
  imported it gets repointed. Scoped to single-file moves - a folder move
  keeps everything *inside* it correct for free (relative positions don't
  change) but doesn't fix up imports crossing the folder's boundary, a
  documented trade-off. 6 unit tests.
- `src/page-components/tree.ts` gained `filterComponentTree` (search: a
  matched folder keeps its whole subtree, a non-matched folder keeps only
  matching descendants) - 5 more unit tests.
- `src/pages/page-components/ComponentTreePanel.tsx` (new) - search box,
  add-file/add-folder icon buttons (inline path-accepting input, so
  `layout/Header.tsx` nests without a per-folder "new here" menu), chevron
  disclosure (hand-rolled, not native `<details>` - the app's global
  `details`/`summary` accordion CSS is sized for full sections, not a dense
  tree, so reusing it would fight a lot of unwanted padding/borders),
  `ContextMenu` (rename/delete, reused as-is - it existed but had no
  caller yet), native HTML5 drag-and-drop (file rows stop propagation on
  `dragover` even when not a valid target, so a drop over a nested file
  doesn't fall through to the root-drop handler and get misread as "move to
  root").
- `PageComponents.tsx` rebuilt around the shell: toolbar (sidebar
  toggle + Save, no title/description text) → resizable sidebar + resizable
  preview/editor split. `handleMove` composes `rewriteImportsAfterMove` +
  `api.move` + `api.save` for every affected file, then reloads the tree -
  same "reload as source of truth" pattern the create/delete handlers
  already used.
- CSS: full-bleed shell cancels `.content`'s own padding via matching
  negative margins and sizes to `calc(100dvh - var(--dry-topbar-height))` -
  no card background/border-radius/shadow. New reusable `.button-group`
  (connected segmented control) replaces `[role=tablist]` for the Mobile/
  Tablet/Desktop picker, since the global tab style is underline-based and
  not what a "grouped button" look calls for.
- Browser QA (same minted-session Playwright approach as before, dev server
  did NOT need a restart this round - only client-side files changed):
  create file/folder via the new buttons, nested-path creation, search
  filter (hides non-matches, keeps ancestor folders of a match), rename via
  context menu, sidebar resize + collapse/expand, and - the one worth
  double-checking - a real `dragTo()` drag of `Btn.tsx` into `widgets/`:
  confirmed via direct API reads afterward that `widgets/Btn.tsx` exists,
  the old path 404s, and a sibling file's `import Btn from "./Btn.tsx"` was
  rewritten to `"./widgets/Btn.tsx"` **and persisted** (not just corrected
  in the open editor buffer). Zero console errors on a clean-slate run; a
  409/404 seen on one earlier run turned out to be re-running the QA script
  against already-existing leftover data, not a real bug. Test data cleaned
  from the live dev store afterward both times.

## Update 2026-08-04 (v3): visual polish pass

User flagged the v2 redesign as "not matching the design" with a real
screenshot of their (dark-theme) browser - two concrete bugs, plus two
placement requests:

- Selection highlight only covered the inner label button, not the
  chevron/icon - moved `.selected` to the row itself (`ComponentTreePanel.tsx`
  builds the row's class list from `[base, selected && "selected", ...]`
  instead of putting it on the nested item button).
- Tree was too cramped vs. the shadcn reference - bumped row padding/gap,
  forced icon size via `.page-components-tree-row svg` (icons are `1em`
  by default, so they were inheriting a small ambient font-size), and
  replaced the per-row `depth * remrem` inline padding with a real nested
  `.page-components-tree-children` wrapper (indent + `border-inline-start`)
  so each folder level gets one continuous guide line, not just spacing -
  `depth` prop dropped from `ComponentTreeList` entirely, no longer needed.
- Device picker moved out of the preview panel into the page's main
  toolbar, next to the sidebar-toggle button. Required splitting state out
  of `ComponentPreview.tsx` into `useDevicePreview.ts` (the width/scale/
  ResizeObserver logic) so `DevicePickerControls.tsx` (toolbar) and
  `ComponentPreview.tsx` (now just the frame) can share it from two
  different places in the tree. `.page-components-preview`/`-toolbar` CSS
  removed as dead code.
- Shell went full-bleed: cancels `.content`'s own padding via matching
  negative margins, sized to `calc(100dvh - var(--dry-topbar-height))`, no
  card background/border-radius/shadow.

Re-verified with the same minted-session Playwright QA loop after each
change (typecheck + 668 tests green throughout); test data cleaned from the
live dev store again afterward.

## Speed

Complete in one session (three passes: initial build, VS Code-style
redesign, then this visual-polish pass after a real screenshot review).

## Superseded 2026-08-11

This whole feature was REMOVED and folded into the Page Editor - see
`plans/component.md` + `status/component.md`. Components no longer have
their own page (`/dry/page-components`), their own storage root
(`.dry/components`, `DryOption.pageComponents`), their own API route
(`routes/page-components.ts`) or their own permission
(`system-page-components`); they are files in `pagesSourceStorage`'s
`component/` source root, edited from the Page Editor's Component tab under
the Page Builder permission. Still alive from this work:
`ComponentTreePanel.tsx`, `useDevicePreview.ts`, `page-components/tree.ts`,
`import-rewrite.ts`. Kept for the history of WHY those pieces look the way
they do.
