# RichTextField freezes while typing Vietnamese (IME)

## Plan

Reported symptom: the RichText field locks up ("kẹt cứng") while typing
Vietnamese, suspected to be a re-render storm.

Root cause (confirmed, see Status): a live IME composition is not one
keystroke. Vietnamese Telex composes a whole syllable ("tieengs" → "tiếng"),
and prosemirror-view's DOM observer flushes on every mutation the IME makes
along the way, so each letter arrives as its own transaction **while the
composition is still open**. Per letter, the field then:

1. built a brand-new `ToolbarState` and `setState`d it unconditionally →
   re-rendered the toolbar + the three floating menus,
2. lifted that state to `RichTextField` (`editor-surface.tsx`'s `onReady`
   effect, keyed on the state object's identity) → a second render pass,
3. serialized the ENTIRE document to HTML (`exportCleanHtml`) and pushed it up
   through `onChange` → `ContentEntryEditor` re-rendered and re-serialized /
   re-parsed / re-diffed the whole entry (`isDirty`, `originalValue`,
   `previewDiffs` all ran on every render, unmemoized),
4. and the resulting `value` round trip could land back in the sync effect and
   `replaceWith()` the whole document — tearing down the very DOM text node
   the IME was still composing into.

Nothing in the field looked at `EditorView.composing` (or `event.isComposing`)
anywhere, and the slash/mention popups additionally swallowed Enter/Space in a
capture-phase keydown listener — the keys Vietnamese Telex uses to commit a
syllable.

Fix order:

1. Hold back export/`onChange`/toolbar state while `view.composing`; flush once
   when the composition ends.
2. Never `replaceWith()` an external value mid-composition; park it and apply
   it on composition end.
3. Tag external-sync transactions so they aren't echoed back out through
   `onChange`.
4. Compare `ToolbarState` before `setState` so an unchanged toolbar doesn't
   re-render the field.
5. Stop the slash/mention popups from reacting to (or stealing keys from) a
   live composition, and stop their listeners churning on every transaction.
6. Memoize `ContentEntryEditor`'s per-render entry serialization/diff.
7. Real IME regression test.

## Status

Done, verified.

Changed:

- `src/components/RichTextField/useRichTextEditor.ts` — composition-aware
  `dispatchTransaction` (`pendingCompositionChange` + `flushEditorState` +
  a `compositionend` backstop timer), composing guard + deferred apply in the
  external-value sync effect, `EXTERNAL_SYNC_META` so an external write isn't
  echoed back, `toolbarStateEqual` bail-out, and `valueRef` so a `value` that
  changes while the async component registry is still loading isn't dropped.
- `src/components/RichTextField/dry-richtext-slash.tsx` — `isComposing` /
  `keyCode === 229` guard in the capture-phase keydown, composition guards in
  the `input`/`selectionchange` handlers, and `stateRef` so `ToolbarState` is
  out of the listener effect's dependency list.
- `src/components/RichTextField/dry-component-mention.tsx` — same three guards.
- `src/components/RichTextField/toolbar.tsx` — the document `click` listener is
  mount-once instead of re-attached on every render.
- `src/components/RichTextField/dry-component-view.ts` — added `destroy()`, so
  a resize interrupted by the node being destroyed doesn't leak its `window`
  pointer listeners.
- `src/pages/ContentEntryEditor.tsx` — `originalValue` / `isDirty` /
  `previewDiffs` memoized on their real inputs.

Verification (`e2e/richtext-ime.spec.ts`, real compositions driven through
CDP's `Input.imeSetComposition`, not synthetic events):

- Before the fix: composing "tiếng Trường Nguyễn" into an EMPTY document
  **times out at 30s and the page dies** ("Target page, context or browser has
  been closed") — the reported freeze, reproduced.
- After: same test passes in ~1.7s, text intact, zero document rebuilds during
  the composition, and the composed value saves and reloads correctly.

`bun run typecheck` clean. `bun run test`: same 16 pre-existing failures as on
a clean tree (sqlite/content-types seed drift), none related. Full e2e suite:
same 3 pre-existing failures with or without the new spec (those specs race
each other on the shared test DB under parallel workers).

Not changed (noted, out of scope): the entries LIST endpoint projects richtext
columns out of its rows - that is deliberate, not a bug; read the entry by id
for the body.

## Speed

One pass, no blockers. The one detour was the regression test asserting
against the list endpoint (which nulls richtext by design) before switching to
the by-id endpoint.
