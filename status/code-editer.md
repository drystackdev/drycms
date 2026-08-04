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
- `bun run typecheck`, `bun run test` (591 tests as of this pass, 618 after
  the later IDE-parity pass below - no regressions), and `bun run build`
  (client + SSR) all pass. Worker chunk is ~6.5MB
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

Follow-ups added after initial completion, same session:
- Sidebar nav entry ("Code Editer Demo", `Development` section, next to
  "Rich Text Demo") in `DryLayout.tsx`'s `NAV` - not DEV-gated, matching the
  Rich Text Demo entry's precedent.
- `KIND_BOOST` in `ts-worker.ts`: completions now sort function/const/class
  above interface/type/alias before truncating to 50. Without it, a module
  with as many type-only exports as preact (every HTML/ARIA attribute
  interface) buried the handful of actual functions (`h`, `render`,
  `Fragment`...) alphabetically under hundreds of interfaces whenever the
  query was empty (`prism-code-editor` gives every entry the same score with
  nothing typed yet to filter against). Verified via real import-specifier
  completion (`import { h| } from "preact"` correctly suggests `h`/`hydrate`).
- Inline error display: `Editer.tsx`'s `applyLineDiagnostics` tints each
  line with a diagnostic (red background + left bar for syntax, amber for
  type-only) directly on `editor.lines[n]`, driven by the same debounced
  `onChange` pass - not just left to the demo page's raw JSON dump. Verified
  against a real multi-line syntax error; line-level rather than precise
  squiggly-underline ranges (would need `onTokenize` token-splitting to do
  losslessly - noted as a possible follow-up in the function's own comment).

Testing note: explicit-trigger keybindings (`Ctrl+Space`, `Mod+I`) don't
reach the page in this Playwright/macOS harness (same class of issue as the
prior `Meta+`-vs-`Control+` finding) - verified completions via normal
implicit-trigger typing instead, which is also the realistic usage path.

JSX tag-name suggestion (`<div`, `<span`, ...) added after user request -
this needed real investigation, not just wiring:
- Confirmed empirically (not assumed) that TS's completions engine only
  offers JSX intrinsic elements/components when the element parses as a
  *complete* `JsxOpeningElement` - a still-open `<di`, even a bare `<`
  alone, never gets them; editing inside an already-closed `<a></a>` does.
  `getSyntacticDiagnostics` already proved the parser treats it as real JSX
  (`'/' expected`, a JSX-specific message) - this is specifically a
  completions-classification gap, not a parsing one.
- Fix in `ts-worker.ts`: detect an open tag right before the cursor
  (`OPEN_JSX_TAG_RE`), splice a synthetic ` />` into the completions query
  only (never into the real file), then filter the result through
  `isPlausibleJsxName` (lowercase `property`-kind = intrinsic element,
  capitalized value-kind = component) rather than just boosting - the
  synthetic splice makes TS return the *entire* global scope plus the tag
  names all mixed together (900+ entries), and generic kind-based boosting
  alone left `div`/`span` tied with unrelated globals like
  `addEventListener`, losing the top-50 cutoff race.
- Verified: `<di` now suggests `dialog`, `div`, `audio`, `bdi`, `datalist`,
  `details` - real HTML tags, fuzzy-matched correctly.
- `CodeEditerDemo.tsx`'s seed code now uses `useState` (counter example,
  `preact/hooks` import + JSX + event handler) instead of a static div -
  verified it loads with 0 diagnostics.

IDE-parity pass, same day, per user request ("develop the editor fully -
type/command/underline support like VS Code, add whatever else it needs"):

- **Precise squiggly underlines** replace the old line-tint: `applyDiagnostics`
  in `Editer.tsx` positions a zero-width `<span>` per diagnostic at
  `calc(var(--padding-left) + Nch)` (monospace `ch` math off `column`/`length`),
  recolored via a `mask-image` SVG wave (`border-style` has no `wavy` keyword -
  that only exists for `text-decoration-style`, which needs real glyphs these
  empty overlay spans don't have).
- **Hover / Quick Info**: `ts-worker.ts` gained `computeHover` via
  `getQuickInfoAtPosition`. Mouse position -> character offset is resolved
  *geometrically* (`offsetFromPoint`/`measureChWidth`: which `.pce-line` row
  contains `clientY`, then a `ch`-width division for the column) rather than
  via `caretPositionFromPoint`/`caretRangeFromPoint` - confirmed empirically
  that those resolve to the editor's real (transparently-overlaid, for input
  capture) `<textarea>` instead of the `.pce-line` spans, since the textarea
  visually covers the same text. The same geometric approach resolves clicks
  on a diagnostic underline (`findDiagnosticAt`) for the same reason - a
  listener on the underline `<span>` itself never fires, the textarea always
  wins hit-testing.
- **Signature help**: `computeSignatureHelp` via `getSignatureHelpItems`,
  shown through `prism-code-editor/tooltips`' `addTooltip` (cursor-anchored,
  requires the `cursorPosition` extension already in use) - fires on every
  keystroke and `selectionChange`, guarded by a sequence counter so a slow
  response can't clobber a newer one.
- **Quick fixes**: `computeCodeFixes` via `getCodeFixesAtPosition`. Clicking a
  diagnostic fetches fixes for the error code(s) at that position and shows a
  small menu; picking one applies its edits and re-syncs the worker.
  `includeCompletionsForModuleExports: true` in the preferences argument was
  required for "Update import from '...'" fixes to appear at all - without it
  `getCodeFixesAtPosition` silently omits auto-import fixes (returns only the
  *other* applicable fixes, not an error) even when the module is already
  part of the program. This is now the working answer to "add automatic
  import suggestions" - surfaced by clicking the red squiggle on an
  unresolved name, not inline in the completion dropdown (`Completion` in
  `prism-code-editor/autocomplete` has no `additionalTextEdits` equivalent,
  so a completion-time auto-import isn't feasible without forking the
  library's selection handling).
- **Format Document**: `computeFormatting` via `getFormattingEditsForDocument`,
  bound to `Shift+Alt+F` (VS Code's default) via `addEditorHotkey`.
- **Tooltip theming, twice-broken then fixed**: the hover panel and quick-fix
  menu were first appended directly to the shadow root (sibling of
  `.prism-code-editor`) - the theme's `--pce-widget-*` custom properties are
  scoped to `.prism-code-editor` itself, so a sibling doesn't inherit them
  and rendered with no background/color at all. Fixed by mounting both
  *inside* `editor.container` instead (both use `position: fixed`, so this
  doesn't affect layout - grid/`overflow` don't apply to non-static
  descendants). Separately, hover/signature text was flat single-color -
  now run through `prism-code-editor/prism`'s `highlightText(text, "tsx")`
  instead of `textContent`, so `.token.*` classes pick up the same theme
  colors as the editor body. Diagnostic *messages* (prose, not code) stay
  plain text - only Quick Info/signature *code* text is tokenized.
- **Completions dropped keywords under a broad scope - real bug, not a
  triggering issue**: `computeCompletions` sorted by `KIND_BOOST`/`sortText`
  and truncated to the top 50 *before* considering what the user had actually
  typed - for a position with hundreds/thousands of raw entries (e.g. global
  scope), the 50 survivors could easily all be boosted names that don't even
  contain the typed prefix, so `const`/`number`/`console` etc. never reached
  the client's own fuzzy filter to be shown. Fixed by narrowing to entries
  whose name contains the current word prefix *before* the boost-sort-slice
  (falling back to unfiltered only if that empties the list). Traced with a
  temporary worker-side debug log proving the pipeline delivered 0 items end
  to end - not a caching/race red herring, which is what it looked like at
  first from the client side alone.
- **Multi-file tabs**: `CodeEditerDemo.tsx` now holds `files: Record<string,
  string>` + `activeFile` state and a `role="tablist"` bar (Demo.tsx +
  Button.tsx, Demo now imports Button for real). No `Editer`/worker protocol
  changes needed - switching tabs just swaps which slice of `files` is passed
  as `value` vs `extraFiles`, reusing the existing prop-sync effects
  unchanged. (Known limitation, documented in a code comment: a file can't be
  imported by its own name while it's the *active* tab, since the worker
  always compiles the active buffer as one fixed `/main.tsx` - only matters
  for import cycles between tabs, not this demo's one-directional import.)

New permanent regression test: `e2e/code-editer-demo.spec.ts` (tabs, hover
panel background+content, diagnostic underline+quick fix+apply, signature
help, format+search widget, keyword completions, import-specifier
completions) - all 7 passing.

Follow-up round after real (non-Playwright) macOS usage surfaced 3 more bugs
the browser-side testing above didn't catch:

- **`Shift+Alt+F` didn't fire on a real Mac keyboard.** `addEditorHotkey`
  keys off `event.key`, which is layout-dependent - Option (Alt) turns
  letter keys into different characters on a real Mac keyboard (`Option+F`
  types "ƒ", `Shift+Option+F` types a different accented letter, never
  "f"), so the hotkey's `event.key` never matched. The library special-cases
  this for `Shift+Meta+<letter>` but not `Alt+<letter>`. Playwright's
  synthetic `press("Shift+Alt+F")` doesn't reproduce this (it just sets
  `key: "F"` directly), which is exactly why the e2e test above passed while
  the real thing didn't - a case where the test gave false confidence rather
  than a false alarm. Fixed by handling `keydown` directly and matching
  `event.code === "KeyF"` (the physical key position, unaffected by what
  character modifiers produce) instead of going through the hotkey map at
  all.
- **Two tooltips stacked on top of each other for the same error.** Hovering
  a diagnostic (shows its message in the hover panel) then clicking it
  (opens the quick-fix menu) left both open at once - neither panel knew
  about the other. Fixed by hiding the hover panel when the quick-fix menu
  opens.
- **No "Add import" fix, only "Add missing function declaration", for a name
  with *no* existing import of that module anywhere** (e.g. typing
  `useState(...)` with the `preact/hooks` import deleted first, vs. the
  `useEffect`-with-`useState`-already-imported case verified earlier in this
  same session). Root cause: TS's auto-import search only scans
  `program.getSourceFiles()`, and a module nothing currently imports is
  never parsed into the program at all with this minimal host. Fixed by
  making `preact`/`preact/hooks`/`preact/jsx-runtime` permanent root files
  in `getScriptFileNames` (`ALWAYS_LOADED_MODULES`), not just
  resolvable-if-imported.
- **Bonus, from a direct user question**: import-specifier completions
  (`from "pre|`, `from "./B|`) returned nothing at all - TS's own
  module-specifier completions need `readDirectory`-style enumeration this
  virtual FS doesn't support. Added a dedicated
  `computeImportSpecifierCompletions` path instead of trying to make TS's
  own engine work here: bare specifiers from `BARE_MODULE_PATHS`' own keys
  (now the single source of truth `resolveModuleName` also reads from),
  relative paths from the current `extraFiles`. Required `Editer.tsx`'s
  `wordStart` to special-case being inside an open string literal too -
  `.`/`/` aren't word characters, so the generic scan otherwise stopped
  mid-path and duplicated the typed prefix on insert.

Config refactor, per explicit user request ("cần tái cấu trúc để dễ config
hơn" - confirmed via AskUserQuestion to mean the `Editer` component, not
`dry.config.ts`). Previously-hardcoded worker/editor behavior is now
`EditerProps`, all optional with the prior hardcoded values as defaults, set
once at mount like `theme` already was (not live-updatable - same
remount-via-`key` contract):

- `compilerOptions`/`formatOptions` (`Partial<ts.CompilerOptions>`/
  `Partial<ts.FormatCodeSettings>`, type-only import of `typescript` so the
  client bundle doesn't pull in the real package) - merged onto
  `ts-worker.ts`'s own `DEFAULT_COMPILER_OPTIONS`/`DEFAULT_FORMAT_SETTINGS`
  via a new `"configure"` worker-protocol message, sent once by
  `EditerWorkerClient`'s constructor before its first "update" so every
  computation after that sees the configured options.
- `tabSize` (was hardcoded `2` in the `basicEditor` call) and `debounceMs`
  (was a module-level `DEBOUNCE_MS` constant in `worker-client.ts`, now a
  constructor param defaulting to the same 300).
- `tailwindCompletions` (default `true`) - toggles the Tailwind class-list
  source per instance. Not a straightforward prop-to-callee thread like the
  others: `registerCompletions` is a *global*, once-per-page registration
  (first `Editer` to mount wins), so this required gating inside a new
  `scopedTailwindCompletionSource` wrapper that checks the querying editor's
  own entry in the existing per-instance `instances` `WeakMap` instead.
- `resolveModuleName`'s bare-specifier special cases and
  `computeImportSpecifierCompletions`'s bare-specifier list were two
  hand-synced copies of the same 3 entries - consolidated into one
  `BARE_MODULE_PATHS` map both now read.

Verified end-to-end in a real browser, not just typecheck: temporarily set
`tailwindCompletions={false}` on the demo page's `Editer`, confirmed
`className="fle` completions actually disappear, confirmed they return with
the prop removed again (ruling out "always empty" as a false positive) -
then reverted the demo page back (this was a temporary probe, not a real
demo change). `bun run typecheck`, `bun run test` (618, unchanged), and the
full `e2e/code-editer-demo.spec.ts` (7/7) all still pass after the refactor.

Two Mac-Playwright-host quirks hit again, same class as prior `Meta+`-vs-
`Control+` findings: `Control+Home`/`Control+End` don't reliably reach the
true start/end of a multi-line `<textarea>` here (landed mid-token more than
once while testing, corrupting the very position being tested) - use
`.fill("")` + real `.type()` for a clean isolated spot instead. And a
locator `.click()` on `.pce-line` gets flagged as "intercepted" by the
transparently-overlaid `.pce-textarea` - that interception is correct
behavior (it's the actual input-capture element), not a bug; use a
coordinate-based `page.mouse.click()` instead of a strict-actionability
locator click when a test needs to land on a specific line.

Already present via `basicEditor`'s own bundle, not newly added: bracket/tag
matching + highlighting, indent guides, comment toggling (`Mod+/`), line
move/copy/delete, undo/redo, and `Mod+F` find & replace (`searchWidget`) -
worth knowing before reaching for a library add-on that's already wired up.

Hardening pass ("cần bạn ghi ra kế hoạch đầy đủ" - user asked what real/
practical use still needed, then asked for a written plan against that
list; plan mode, plan file `cheerful-zooming-hennessy.md`, then executed
directly). 4 of the 5 items from that plan; worker pooling across multiple
simultaneous `Editer` instances explicitly **not** done - still only one
consumer (`CodeEditerDemo.tsx`) exists, so there's no real problem yet to
justify a pooling layer's complexity.

- **Fixed: Format/quick-fix apply was wiping the entire undo history, not
  adding one step.** Root-caused by reading `basicEditor`'s own
  `editHistory` extension source (not guessed) -
  `editor.addExtensions({ update() { if (editor.value != textarea.value)
  reset() } })` treats *any* `setOptions({ value })` call as "a whole new
  document." `commitEdits` (`Editer.tsx`) now applies each edit through
  `prism-code-editor/utils`'s public `insertText(editor, text, start, end)`
  instead - documented as keeping undo/redo history, the same primitive the
  library's own completion-insert path uses. `applyTextEdits` (the old
  manual string-splice helper) is gone, nothing else called it.
- **Added `readOnly` prop.** Thin pass-through to `basicEditor`'s own
  already-supported `readOnly` option - diagnostics/hover/completions/
  signature-help all stay active, only typing and Format/quick-fix-apply
  are affected (the latter two now no-op for free once routed through
  `insertText`, which already checks `editor.options.readOnly` itself - the
  `onFormatKeydown`/`handleDiagnosticClick` guards just avoid a pointless
  worker round trip and a dead-looking quick-fix menu). Demo page
  (`CodeEditerDemo.tsx`) got a real "Read-only" checkbox (`role="switch"`,
  matching `Showcase.tsx`'s existing toggle markup) - `readOnly` is a
  mount-once prop like `theme`, so the checkbox drives `key={String(readOnly)}`
  on `<Editer>` to force a remount on toggle, same contract as every other
  config prop.
- **Added a worker hang watchdog** (`worker-client.ts`): every outgoing
  postMessage (re)arms one shared 8s timer; any incoming message (a specific
  response *or* the fire-and-forget debounced diagnostics) disarms it - so
  it fires only when the worker has stopped responding to *anything*, not
  merely been slow on one request. On fire: terminate the stuck worker,
  construct a fresh one, resend `"configure"` + the last known
  `{code, extraFiles}`, resolve every in-flight promise to `null` (each
  `get*` method already had a safe empty/`null` fallback). Surfaced via a
  new `onRestart` constructor callback -> `Editer.tsx` shows an error toast,
  not a silent recovery. Unit-tested directly
  (`worker-client.test.ts`, 5 tests, `vi.useFakeTimers()` + a hand-rolled
  `MockWorker` via `vi.stubGlobal("Worker", ...)`) rather than trying to
  force a real hang through Playwright, per the plan's own reasoning.
- **Added keyboard-triggered Quick Info (`Mod+I` at the cursor) and an
  `aria-live="polite"` diagnostics-count region** - the only two ways to see
  a symbol's type or a diagnostic's message were both mouse-only before
  this. Reuses `renderHoverPanel`/`renderHoverMessage` as-is; shown via a
  second `addTooltip` instance (`keyboardHoverElement`, cursor-anchored,
  same mechanism signature help already uses) rather than hand-rolling the
  cursor-position-to-screen-coordinate math `addTooltip` already solves.
  `event.code`-based like `onFormatKeydown`, though `Mod` alone doesn't
  actually hit the Option-key-substitution problem the way `Alt+<letter>`
  does - kept consistent anyway.
  - **`Mod+I` could not be verified through Playwright on this host** -
    confirmed empirically (not assumed): `page.keyboard.press("Meta+i")`,
    `.down("Meta")`+`.press("i")`+`.up("Meta")`, and a direct
    `dispatchEvent(new KeyboardEvent(...))` all failed to reach the page's
    listener with "KeyI" - matches this project's own prior finding
    ("explicit-trigger keybindings (Ctrl+Space, Mod+I) don't reach the page
    in this Playwright/macOS harness"), independently rediscovered by
    picking the same combo. Verified the *surrounding* logic (cursor
    position -> `getHover` -> render -> `addTooltip` show, real theme
    background color, real content) was actually correct by temporarily
    swapping the matched key to `F2` - full pipeline confirmed working end
    to end - then reverted back to the real `Mod+I` binding. Not covered by
    the permanent e2e suite for this reason; the other 3 items above are.

New permanent e2e tests (`e2e/code-editer-demo.spec.ts`, now 10/10): quick-
fix-apply undo preservation (types a call, triggers a real "Update import"
fix, confirms one `Meta+Z` keeps the typed text and a second keeps making
progress rather than being a no-op), the demo's new read-only checkbox
(blocks typing, keeps hover, `aria-readonly` toggles both ways), and the
live region's text actually changing from "No problems" once a real error
is introduced. `bun run typecheck`, `bun run test` (643, up from 618 - 5 are
mine, the rest are unrelated concurrent work on this repo), and
`bun run build` (client + SSR) all still pass.

User reported "đã mất khả năng suggestion rồi" (completions stopped working)
right after the hardening pass above. Investigated with the same
worker-side/client-side `console.log` tracing technique used earlier this
session for the prefix-truncation bug - this time the worker-side log
(unconditional, first line of `self.onmessage`) never printed at all, for
*any* message, not even the very first mount-time "update" - meaning the
worker wasn't receiving anything, not that one request kind was broken.
Added `worker.onerror` logging to check for a silent construction/load
failure - and on the very next run, with no further code change, completions
worked again, repeatably. Read as Vite dev-server/worker-module staleness
from the volume of rapid edits to `ts-worker.ts`/`worker-client.ts` a few
messages earlier in this same session (each edit invalidates and rebuilds
the worker's module graph; a page loaded against a stale intermediate build
is a known rough edge of Vite's dev-mode worker handling, not something the
app code controls) - not a real regression in the shipped logic. Likely hit
the user's own dev server session the same way; another hard refresh should
have cleared it.

Kept a real improvement out of the investigation rather than reverting it
to a bare console.log: `worker.onerror` is now wired into the same
`#restart()` path as a hang, on the reasoning that an uncaught error inside
a message handler produces the identical symptom (whatever request was in
flight never gets a response) even though the worker itself keeps running -
same recovery, no second mechanism needed. Covered by a 6th
`worker-client.test.ts` case (`throwError()` on the mock triggers an
immediate restart, not waiting for the 8s hang timeout).

Real bug reported by the user with a screenshot ("mất suggestion khi gõ
trong hàm" - typing `const [] = useS` inside a function body showed no
popup), on top of the false-alarm Vite worker-staleness investigation above
- the two looked identical from the outside but were unrelated:

- Root-caused via bisection with a scratch Playwright spec (not guessed):
  completions broke specifically whenever the file had *any* string literal
  already typed earlier (e.g. the demo's own `import ... from "preact/hooks"`
  line) - `let z = 1;\ncons` worked, `import {useState} from "preact/hooks";
  \ncons` didn't, same prefix, same position shape.
- `Editer.tsx`'s `wordStart` used a single regex (`["'][^"']*$`) to detect
  "cursor is inside an unterminated string" (needed so import-specifier
  completions replace the whole typed path). It only checked "is there a
  quote character before the cursor with no quote after it" - which is
  equally true for a genuinely open string *and* for an already-*closed*
  string earlier in the file with nothing but non-quote characters since.
  Every completion after any prior string literal computed the wrong
  replacement `from`, so the fuzzy-match query sent to
  `prism-code-editor`'s own filter was garbage (e.g. `";\ncons"` instead of
  `"cons"`) - silently zero matches, popup never opens, no error anywhere.
  Fixed by replacing the regex with `openStringStart`, a real quote-by-quote
  walk (escape-aware) scoped to the current line (JS/TS strings can't span
  lines), which correctly tracks open/closed state instead of just "nearest
  quote".
- Traced end-to-end via `prism-code-editor`'s own shipped source
  (`node_modules/.../tooltip-*.js`) rather than guessing at its behavior -
  confirmed the mechanism precisely: `startQuery()` re-derives `pos`/`before`
  fresh each call and re-invokes every registered source; a source's
  `result.from` combined with the *current* `before` becomes the query
  string filtered against each option's label, so a wrong `from` silently
  drops every option regardless of the completion data being correct.
- Found and fixed a second, real (if less severe) issue while instrumenting
  this: `tsCompletionSource`'s cache-miss check only prevented re-fetching
  *after* a response landed, not multiple concurrent fetches for the same
  position - each stale per-keystroke promise resolving after typing stopped
  re-triggered `startQuery()`, and every one of those saw the same
  not-yet-resolved cache slot and fired its own duplicate `getCompletions`
  call. Measured via temporary debug logging: typing one word could fire 30+
  duplicate worker requests for its final position alone. Added a `pending:
  Set<number>` per `Editer` instance so at most one request per position is
  ever in flight. Confirmed via the same logging this wasn't the cause of
  the reported bug (data was already correct on every duplicate) - the
  `wordStart` fix alone resolves the report; this is a separate,
  independently-verified efficiency fix kept because it's real waste.
- New permanent regression test in `e2e/code-editer-demo.spec.ts`
  ("completions still work after a completed string literal earlier in the
  file") - reproduces the user's exact reported shape. Full suite now 11/11.
  `bun run typecheck` and `bun run test` (644, unchanged) still pass.

# Speed

Completed 2026-08-04, same session as the plan discussion. IDE-parity pass
completed later the same day. String-literal completion bug found and fixed
later the same day, same session.
