# Editer hardening pass: undo-history fix, readOnly, worker watchdog, accessibility

## Context

`Editer` (`src/components/Editer/`) is now a fairly complete TSX/Preact code
editor: diagnostics, completions (keywords/imports/JSX/Tailwind), hover,
signature help, quick fixes (incl. auto-import), `Shift+Alt+F` format,
configurable compiler/format options, multi-file tabs in the demo page. The
user asked what it would still need for real/practical use beyond IDE-parity
features, and asked for a full written plan to address the answer.

Of the 5 things raised, this plan covers 4 concrete implementation items,
ordered by how much they matter to a user right now vs. how large the
change is. The 5th (worker pooling across multiple simultaneous `Editer`
instances) is **not** implemented here - `Editer` has exactly one consumer
today (`CodeEditerDemo.tsx`), so building a pooling layer now would be
solving a problem that doesn't exist yet. It's noted at the end as a
documented constraint to revisit if/when a second real consumer shows up.

## 1. Fix: Format/Quick Fix apply wipes the entire undo history (highest priority - real bug, already root-caused)

**Root cause, verified by reading the actual library source**
(`node_modules/prism-code-editor/dist/commands-Ccvb6hCK.js`, the
`editHistory` extension `basicEditor` already wires up): it registers
`editor.addExtensions({ update() { if (editor.value != textarea.value)
reset() } })`. `reset()` collapses the entire undo stack down to one entry.
`Editer.tsx`'s `commitEdits` (used by both `client.getFormatting()` and the
quick-fix menu's apply handler) currently calls `editor.setOptions({value:
next})` directly - which is exactly the `editor.value != textarea.value`
transition `editHistory` treats as "a whole new document," discarding every
prior undo step, not just adding one new one. `Ctrl+Z` right after a format
either does nothing useful or jumps back further than the user expects.

**Fix**: `prism-code-editor/utils` exports `insertText(editor, text, start?,
end?, newCursorStart?, newCursorEnd?)` - public API, doc'd as "Inserts text
into the editor (unless it's read-only) **while keeping undo/redo
history**." It's the same primitive the library's own completion-insert
path uses. Rewrite `commitEdits` in `Editer.tsx` to apply each
`EditerTextEdit` via `insertText(editor, edit.newText, edit.start,
edit.start + edit.length)` in descending-`start` order (same ordering
`applyTextEdits` already uses, so earlier positions stay valid as later
edits are applied), instead of splicing a new full-document string and
calling `setOptions`. Drop `applyTextEdits` (no longer needed once nothing
calls it). After the loop, still call `client.update(editor.value,
extraFilesRef.current)` and `cache.clear()` exactly as today, to resync the
worker/diagnostics.

**Scope note**: leave the tab-switch / `value`-prop-sync effect
(`useEffect` watching `value`) exactly as is, still using `setOptions`.
Switching files *should* reset undo history - you wouldn't expect `Ctrl+Z`
in file B to undo something typed in file A. Only `commitEdits` (edits
within the current document) changes.

**File**: `src/components/Editer/Editer.tsx` (`commitEdits`, `applyTextEdits`, the `import` line for `prism-code-editor/utils`).

## 2. Add a `readOnly` prop

`prism-code-editor`'s `EditorOptions.readOnly` is already a first-class,
fully-supported option (`basicEditor` respects it generically, and its own
CSS already has `.pce-readonly` hooks loaded via the search/autocomplete
CSS already injected) - this is a thin, low-risk prop-through, not new
editor behavior to build.

- Add `readOnly?: boolean` (default `false`) to `EditerProps`, pass through
  to the `basicEditor(host, { ..., readOnly })` options object.
- Diagnostics/hover/completions/signature-help stay fully active in
  read-only mode (useful for reviewing generated/example code with type
  errors surfaced) - only *editing* is affected.
- `insertText` (from fix #1) already no-ops under `editor.options.readOnly`
  on its own, so Format/Quick-Fix-apply become safe no-ops automatically -
  no extra guard needed for correctness. As a small polish, skip the
  `Shift+Alt+F` worker round-trip and skip opening the quick-fix menu at all
  when `editor.options.readOnly` is true, so read-only mode doesn't fetch
  work it'll then throw away or show actionable-looking UI that does
  nothing.

**File**: `src/components/Editer/Editer.tsx` (`EditerProps`, the
`basicEditor` call, the `onFormatKeydown`/`handleDiagnosticClick` guards).

## 3. Worker hang watchdog

Real risk given this runs a full `ts.createLanguageService` per instance:
pathological input theoretically can make a single-threaded worker spin
forever on one message, after which every subsequent request (which all go
through the same message queue) hangs too - currently there's no recovery,
the editor would just silently stop updating.

**Approach**:
- `EditerWorkerClient`'s `#request` (used by completions/hover/
  signatureHelp/codeFixes/format) races each pending request against a
  timeout. Track the oldest unresolved request's age; if it exceeds the
  timeout, treat the worker as hung rather than just slow on one query.
- On a confirmed hang: `terminate()` the stuck worker, construct a
  replacement (`new Worker(...)`), re-send `"configure"` with the same
  `compilerOptions`/`formatOptions`, then re-send `"update"` with the last
  known `{code, extraFiles}` (`#latest`, already tracked) so the fresh
  worker's virtual FS matches what's on screen. Reject all currently
  in-flight promises so callers don't hang forever waiting on the dead
  worker.
- Surface this rather than fail silently: `EditerWorkerClient`'s
  constructor gains an optional `onRestart?: () => void` callback;
  `Editer.tsx` passes one that shows a `toast.add({type: "error", title:
  "..."})` (same `toast` module `handleDiagnosticClick` already imports),
  so a real hang is visible instead of the editor just going quiet.
- Exact timeout value is an implementation detail to tune while building
  (starting point: a few seconds - long enough that a legitimately slow
  request on a large file isn't mistaken for a hang).

**Files**: `src/components/Editer/worker-client.ts` (the new watchdog/
restart logic), `src/components/Editer/Editer.tsx` (wiring `onRestart` to a
toast).

## 4. Accessibility: keyboard-triggered hover + diagnostics live region

Scoped down from the original "mobile/accessibility" framing - a full
touch-gesture redesign (tap-to-hover, long-press menus) is a much bigger UX
effort this CMS's admin-panel context likely doesn't need; **not** part of
this plan. What's in scope:

- **Keyboard-triggered Quick Info**: right now hover only fires from mouse
  position. Add one keybinding (mirroring VS Code's "Show Hover" action)
  that calls `client.getHover(pos)` for the position at the *cursor*
  (`editor.getSelection()[0]`) instead of mouse coordinates, and positions
  the existing hover panel via the `cursorPosition` extension's
  `getPosition()` (already added to every editor instance) instead of
  `clientX`/`clientY`. Reuses `renderHoverPanel`/`showHoverPanel` as-is -
  only the trigger and positioning source change. Implemented the same way
  as the `Shift+Alt+F` fix: a manual `keydown` listener matched on
  `event.code`, not `addEditorHotkey`, for the same Mac-Option-key-produces-
  a-different-character reason already hit once this session.
- **Diagnostics live region**: a visually-hidden (`position:absolute;
  width/height:1px; overflow:hidden`, not `display:none` - screen readers
  ignore that) `<div aria-live="polite">` mounted alongside the hover panel,
  updated whenever diagnostics change (same place `applyDiagnostics` already
  runs) with a short summary - e.g. "2 errors, 1 warning" - so a screen
  reader user gets *some* signal that something changed without needing to
  see the squiggles.

**File**: `src/components/Editer/Editer.tsx` (new keydown handler +
live-region element, alongside the existing hover/diagnostics code).

## Not implemented now: worker pooling

Documented in `status/code-editer.md` as a known scaling constraint (each
`Editer` spins up its own dedicated worker + full TS lib/preact types,
~6.5MB), not built, since there's no second consumer today to justify the
added complexity of a shared pool/multiplexed language service. Revisit if
`Editer` gets embedded somewhere a page can have several instances mounted
at once.

## Verification

- `bun run typecheck` after each numbered section (small enough to check
  incrementally rather than only at the end).
- `bun run test` (must stay at 618 passing, no regressions).
- Real-browser checks via the existing Playwright e2e setup
  (`e2e/code-editer-demo.spec.ts`, `bun run test:e2e -- code-editer-demo`),
  extending it with:
  - #1: apply a quick fix or run Format, then send `Meta+z` (this session's
    established Mac-host convention for `Mod+`) and assert the *specific*
    edit is undone and earlier history is still intact (e.g. type something,
    format, undo once -> format is gone but the earlier typed text remains,
    undo again -> that's gone too).
  - #2: `readOnly` snapshot renders diagnostics/hover but typing has no
    effect and the quick-fix menu doesn't open.
  - #3: harder to trigger a real hang in a test - at minimum, unit-test
    (`bun run test`, Vitest) the timeout/restart bookkeeping in
    `EditerWorkerClient` directly (mock `Worker`) rather than trying to
    force an actual TS hang in Playwright.
  - #4: the new keybinding shows the hover panel with the same content as
    a mouse hover would; the live region's text content updates when a
    syntax error is introduced.
- As in every prior round this session: verify in the *real* dev server too
  (not just the isolated e2e one), since two bugs this session (the Mac
  Option-key hotkey issue, the two-tooltips-stacked issue) were only ever
  visible there, not through automated testing.
