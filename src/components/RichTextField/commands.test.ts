import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { isInlineSelection } from "./commands.js";
import { schema } from "./schema.js";

/**
 * Covers `isInlineSelection` - the predicate `ai-rewrite-button.tsx`'s
 * "Rewrite selection" uses to decide whether a selection can be replaced
 * in-place (keeping its surrounding block tag) or needs a full block-level
 * replace. `EditorState` construction needs no DOM (unlike `EditorView`),
 * so this is testable the same DOM-free way `marks.test.ts`/
 * `export-fragment.test.ts` already are.
 */

function stateWithSelection(doc: PMNode, from: number, to: number): EditorState {
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
}

describe("isInlineSelection", () => {
  it("is true for a selection entirely inside one paragraph", () => {
    // doc(paragraph("Hello world")) - positions 1..6 select "Hello", both
    // ends resolve to the same paragraph node.
    const doc = schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, schema.text("Hello world")));
    expect(isInlineSelection(stateWithSelection(doc, 1, 6))).toBe(true);
  });

  it("is true for a selection covering an entire heading's content", () => {
    const doc = schema.nodes.doc!.create(null, schema.nodes.heading!.create({ level: 2 }, schema.text("Title")));
    expect(isInlineSelection(stateWithSelection(doc, 1, 6))).toBe(true);
  });

  it("is false for a selection spanning two separate paragraphs", () => {
    const doc = schema.nodes.doc!.create(null, [
      schema.nodes.paragraph!.create(null, schema.text("First")),
      schema.nodes.paragraph!.create(null, schema.text("Second")),
    ]);
    // Position 3 is inside "First", position 9 is inside "Second" (past the
    // first paragraph's own close + the second's open).
    expect(isInlineSelection(stateWithSelection(doc, 3, 9))).toBe(false);
  });

  it("is false for a selection spanning a paragraph and a heading", () => {
    const doc = schema.nodes.doc!.create(null, [
      schema.nodes.heading!.create({ level: 2 }, schema.text("Title")),
      schema.nodes.paragraph!.create(null, schema.text("Body text")),
    ]);
    expect(isInlineSelection(stateWithSelection(doc, 1, 10))).toBe(false);
  });

  it("is true for a selection inside a list item's own paragraph", () => {
    const doc = schema.nodes.doc!.create(null, [
      schema.nodes.bullet_list!.create(null, [
        schema.nodes.list_item!.create(null, schema.nodes.paragraph!.create(null, schema.text("Item one"))),
      ]),
    ]);
    // Position 3 (inside "Item one") to 7 - both resolve to that same
    // list item's inner paragraph, not the list_item or the doc itself.
    expect(isInlineSelection(stateWithSelection(doc, 3, 7))).toBe(true);
  });
});
