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

## Round 2 - the freeze was gone, typing was still wrong

User retested: no more freeze, but Vietnamese came out with accents doubled or
misplaced - "nội dung" typed as "noọội dung" - and they pointed at the
Magic Write value sync as where it started. Their IME is **EVKey**, which
changes the picture completely: EVKey / OpenKey / Unikey / GoTiengViet use no
composition at all. They backspace over what they already committed and
re-insert the accented form, several separate DOM edits within a millisecond
or two. Round 1's composition work never touched that path.

Bisected in the browser with an emulated EVKey key stream (CDP raw Backspace
key events + `Input.insertText`, human 60ms pacing between keystrokes, 8 runs
per configuration):

| configuration | correct |
| --- | --- |
| as shipped in round 1 | 5/8 |
| same, but toolbar state + emptiness not published | 5/8 |
| same, but `onChange` never called (export still runs) | **8/8** |
| plain `<input>` on the same page, identical key stream | 8/8 |

So it was neither the serialization nor the toolbar - it was the parent form
re-rendering synchronously *between* two of the IME's own edits, which loses
the ones still queued. Fix: `onChange` is debounced 150ms
(`VALUE_FLUSH_DELAY_MS`), flushed explicitly on outside pointerdown, blur,
composition end and unmount. Back to 8/8.

That debounce then exposed a latent bug of its own: typing and immediately
clicking Save wrote an empty body. `handleSave` is re-created every render but
the topbar's Save button only receives the new one from a Preact effect, which
runs after paint - a click inside that window ran the previous render's
closure over the previous `value`. Invisible before, because every keystroke
used to report itself. Fixed by having `handleSave` read `valueRef.current`.

## Status

Done, verified.

Changed:

- `src/components/RichTextField/useRichTextEditor.ts` — composition-aware
  `dispatchTransaction` (`pendingCompositionChange` + `flushEditorState` +
  a `compositionend` backstop timer), composing guard + deferred apply in the
  external-value sync effect, `EXTERNAL_SYNC_META` so an external write isn't
  echoed back, `toolbarStateEqual` bail-out, `valueRef` so a `value` that
  changes while the async component registry is still loading isn't dropped,
  and (round 2) the debounced `onChange` — `VALUE_FLUSH_DELAY_MS`,
  `flushValue`, and its four explicit flush points.
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
  `previewDiffs` memoized on their real inputs, and (round 2) `handleSave`
  reads `valueRef.current` instead of its render's closure.

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

Two rounds. Round 1 (freeze) was one clean pass; the only detour was the
regression test asserting against the list endpoint, which drops richtext
columns by design, before switching to the by-id endpoint.

Round 2 cost more, because the first three hypotheses were all wrong and had
to be measured down rather than reasoned about:

- a background `content-types` sync resetting `value` mid-typing — not
  reproducible, `useFetch` only re-emits on a real version change;
- per-keystroke cost scaling with document size — the accuracy threshold was
  identical at 1 and 40 paragraphs;
- Playwright's own `keyboard.type` losing characters below ~20ms — real, but
  identical before and after the fix, so a harness artifact.

What finally settled it was knowing which IME (EVKey, not the built-in Telex)
and one control: the same key stream into a plain `<input>` on the same page,
which never drops anything. Ask for the IME first next time - the two families
have nothing in common at the DOM level.
