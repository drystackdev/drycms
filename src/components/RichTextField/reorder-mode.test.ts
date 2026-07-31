import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "prosemirror-state";
import { isReorderActive, reorderMode, reorderModeKey, toggleReorderMode } from "./reorder-mode.js";
import { schema } from "./schema.js";

function state(): EditorState {
  return EditorState.create({ schema, plugins: [reorderMode()] });
}

describe("reorder mode state", () => {
  it("starts inactive", () => {
    expect(isReorderActive(state())).toBe(false);
  });

  it("toggles on and off without changing the document", () => {
    let current = state();
    const originalDoc = current.doc;
    let transaction: Transaction | undefined;

    toggleReorderMode()(current, (tr) => { transaction = tr; });
    current = current.apply(transaction!);
    expect(isReorderActive(current)).toBe(true);
    expect(current.doc).toBe(originalDoc);

    toggleReorderMode()(current, (tr) => { transaction = tr; });
    current = current.apply(transaction!);
    expect(isReorderActive(current)).toBe(false);
  });

  it("can be closed explicitly after the HTML surface commits", () => {
    let current = state();
    current = current.apply(current.tr.setMeta(reorderModeKey, { active: true }));
    current = current.apply(current.tr.setMeta(reorderModeKey, { active: false }));
    expect(isReorderActive(current)).toBe(false);
  });
});
