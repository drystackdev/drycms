import { Fragment, type Node as PMNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { schema } from "./schema.js";

function needsTrailingParagraph(doc: PMNode): boolean {
  return doc.lastChild?.type !== schema.nodes.paragraph;
}

/**
 * The actual "doc must end with a paragraph" check, applied once to `doc`
 * as loaded - `useRichTextEditor.ts` runs this over the initial value before
 * ever creating the `EditorState`, since `trailingParagraph()`'s own
 * `appendTransaction` below only ever runs on a real dispatched transaction,
 * never retroactively over whatever a field happens to mount with (a saved
 * doc that itself ends in a table/grid/component, with no paragraph after
 * it - e.g. old content from before this invariant existed).
 */
export function withTrailingParagraph(doc: PMNode): PMNode {
  if (!needsTrailingParagraph(doc)) return doc;
  return doc.copy(doc.content.append(Fragment.from(schema.nodes.paragraph!.createAndFill()!)));
}

/**
 * Keeps the invariant `withTrailingParagraph` establishes at load time true
 * across every future edit too - a standing backstop for the same "nothing
 * to click/type into after the last block" problem `insertTable`/
 * `insertGrid`/`dry-component-insert-button.tsx`'s `performInsert` used to
 * each patch for individually, right at their own insertion time. Those
 * one-off fixups only ever ran at insert time, so they couldn't catch a
 * table/grid/component ending up last some other way - most notably
 * `reorder-mode.ts` dragging one to the end of the doc, or a user simply
 * backspacing away the paragraph that used to follow it. `appendTransaction`
 * re-checks after every transaction instead, so the invariant holds no
 * matter how the doc changed, and every insertion command can now rely on
 * it unconditionally rather than re-deriving it themselves.
 *
 * Also relocates the selection into the freshly appended paragraph - the
 * same place every one-off fixup it replaces used to put the cursor after
 * inserting a table/grid/component at the very end of the doc. Safe to do
 * unconditionally: this only ever fires right when the doc's last child
 * just became something other than a paragraph, which - thanks to
 * `withTrailingParagraph` closing the "loaded already in a bad state" gap -
 * only happens as the direct result of the transaction(s) just applied, so
 * relocating the cursor there is always relevant to what just happened, not
 * a surprise jump away from unrelated typing elsewhere.
 *
 * Deliberately *not* gated on `transactions.some(tr => tr.docChanged)`: the
 * lastChild check itself is cheap enough to run on every transaction
 * regardless, and `table.ts`/`grid.ts`'s own `moveAfterTable`/`moveAfterGrid`
 * (the `Tab`/`ArrowDown`-out-of-a-table/grid commands) dispatch a
 * selection-only transaction that never touches the doc at all - gating on
 * `docChanged` would skip them entirely and leave a table/grid that's still
 * the doc's last node (the exact case they exist to move the cursor out of)
 * without ever getting its trailing paragraph appended. */
export function trailingParagraph(): Plugin {
  return new Plugin({
    appendTransaction(_transactions, _oldState, newState) {
      if (!needsTrailingParagraph(newState.doc)) return null;
      const tr = newState.tr.insert(newState.doc.content.size, schema.nodes.paragraph!.createAndFill()!);
      return tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size)));
    },
  });
}
