import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";
import { EditorState, type Transaction } from "prosemirror-state";
import {
  buildDeleteTransaction,
  buildReorderTransaction,
  deleteSelectedBlocks,
  getReorderSelection,
  initialDropTarget,
  isContainerNode,
  isDraggableNode,
  isReorderActive,
  isTrailingEmptyParagraph,
  reorderMode,
  reorderModeKey,
  scopeAnchor,
  toggleReorderMode,
  type DropTarget,
} from "./reorder-mode.js";
import { DEFAULT_GRID_COLUMNS, schema } from "./schema.js";

/**
 * Covers the DOM-free half of this feature - `buildReorderTransaction`'s
 * pure doc-transform logic, plus the plugin's own toggle/meta state - same
 * split `grid.test.ts` already uses for `grid.ts`. `computeDropTarget`'s DOM
 * hit-testing (`document.elementFromPoint`, `posAtDOM`) and the live
 * pointerdown/pointermove/pointerup mechanics need a real mounted
 * `EditorView`, which this repo has no jsdom/happy-dom to run under vitest -
 * covered by the real-browser Playwright check instead
 * (`e2e/richtext-reorder.spec.ts`).
 */

function paragraph(text: string) {
  return schema.nodes.paragraph!.create(null, text ? schema.text(text) : undefined);
}

function gridItem(text: string, attrs?: { colSpan?: number; rowSpan?: number }) {
  return schema.nodes.grid_item!.create(
    { colSpan: attrs?.colSpan ?? DEFAULT_GRID_COLUMNS, rowSpan: attrs?.rowSpan ?? 1 },
    paragraph(text),
  );
}

function listItem(text: string) {
  return schema.nodes.list_item!.create(null, paragraph(text));
}

function tableWithOneCell(text: string) {
  return schema.nodes.table!.create(
    { caption: "", colWidths: null },
    schema.nodes.table_row!.create(null, schema.nodes.table_cell!.create(null, paragraph(text))),
  );
}

/** A table whose one cell holds nothing but the auto-fill placeholder
 * `removableRange` leaves behind once a cell's last real block is dragged
 * out - the exact shape `"replaceCellContent"` targets. */
function tableWithEmptyCell() {
  return tableWithOneCell("");
}

function stateFor(doc: PMNode) {
  return EditorState.create({ schema, doc, plugins: [reorderMode()] });
}

function runMeta(state: EditorState, meta: unknown): EditorState {
  return state.apply(state.tr.setMeta(reorderModeKey, meta));
}

/** Locates the doc position of the first descendant matching `match` -
 * avoids hand-computing `+1`-style position arithmetic for every fixture
 * (which `grid.test.ts` does, but only for a handful of small, well-commented
 * cases); with this feature's wider variety of nesting shapes, looking the
 * position up directly is less error-prone than re-deriving it by hand for
 * every test. */
function posOf(doc: PMNode, match: (node: PMNode) => boolean): number {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (match(node)) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found == null) throw new Error("no matching node found");
  return found;
}

function textOrder(doc: PMNode): string[] {
  const texts: string[] = [];
  doc.forEach((node) => texts.push(node.textContent));
  return texts;
}

describe("toggleReorderMode", () => {
  it("turns reorder mode on, starting with no selection", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    const state = stateFor(doc);
    expect(isReorderActive(state)).toBe(false);

    let tr: Transaction | null = null;
    toggleReorderMode()(state, (t) => (tr = t));
    const next = state.apply(tr!);
    expect(isReorderActive(next)).toBe(true);
    expect(getReorderSelection(next)).toEqual([]);
  });

  it("turns reorder mode off and clears any multi-selection", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    let state = stateFor(doc);
    state = runMeta(state, { toggle: true });
    state = runMeta(state, { setSelected: [0, 5] });
    expect(getReorderSelection(state)).toEqual([0, 5]);

    let tr: Transaction | null = null;
    toggleReorderMode()(state, (t) => (tr = t));
    const next = state.apply(tr!);
    expect(isReorderActive(next)).toBe(false);
    expect(getReorderSelection(next)).toEqual([]);
  });
});

describe("isContainerNode", () => {
  it("treats grid as a container", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("a"));
    expect(isContainerNode(grid)).toBe(true);
  });

  it("does NOT treat table as a container - only its cells accept a drop, never the table itself", () => {
    const table = tableWithOneCell("a");
    expect(isContainerNode(table)).toBe(false);
  });

  it('treats any node whose content spec is exactly "block+" as a container (the generic children:true dry-component shape)', () => {
    // `list_item` happens to share that exact content spec - a convenient
    // static-schema stand-in for a real dry component, which only exists
    // once registered at runtime (see `setRichtextComponents`).
    const item = schema.nodes.list_item!.create(null, paragraph("a"));
    expect(isContainerNode(item)).toBe(true);
  });

  it("does not treat a plain paragraph as a container", () => {
    expect(isContainerNode(paragraph("a"))).toBe(false);
  });
});

describe("isTrailingEmptyParagraph", () => {
  it("is true for a top-level empty paragraph at the very end of the doc", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("")]);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "");
    expect(isTrailingEmptyParagraph(doc, pos, doc.nodeAt(pos)!)).toBe(true);
  });

  it("is false when the last paragraph has text", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "b");
    expect(isTrailingEmptyParagraph(doc, pos, doc.nodeAt(pos)!)).toBe(false);
  });

  it("is false for an empty paragraph that isn't last", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph(""), paragraph("b")]);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "");
    expect(isTrailingEmptyParagraph(doc, pos, doc.nodeAt(pos)!)).toBe(false);
  });

  it("is false for a doc-final empty paragraph nested inside the last container - real content, not a landing-spot filler", () => {
    const grid = schema.nodes.grid!.create(null, gridItem(""));
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), grid]);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "");
    expect(isTrailingEmptyParagraph(doc, pos, doc.nodeAt(pos)!)).toBe(false);
  });
});

describe("scopeAnchor", () => {
  it("scopes every top-level block to the same anchor", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posB = posOf(doc, (n) => n.isTextblock && n.textContent === "b");
    expect(scopeAnchor(doc, posA)).toBe(-1);
    expect(scopeAnchor(doc, posB)).toBe(-1);
  });

  it("scopes a block inside a grid_item to the grid itself, not the grid_item", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a"), gridItem("b")]);
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), grid]);
    const gridPos = posOf(doc, (n) => n.type === schema.nodes.grid);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posB = posOf(doc, (n) => n.isTextblock && n.textContent === "b");
    expect(scopeAnchor(doc, posA)).toBe(gridPos);
    expect(scopeAnchor(doc, posB)).toBe(gridPos);
  });

  it("scopes a grid_item target position (a replaceGridItem/afterGridItem target) to the same grid anchor as a block already inside it", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("a"));
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), grid]);
    const gridPos = posOf(doc, (n) => n.type === schema.nodes.grid);
    const itemPos = posOf(doc, (n) => n.type === schema.nodes.grid_item);
    expect(scopeAnchor(doc, itemPos)).toBe(gridPos);
  });

  it("scopes a block inside a table cell to that specific cell", () => {
    const table = tableWithOneCell("a");
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), table]);
    const cellPos = posOf(doc, (n) => n.type === schema.nodes.table_cell);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    expect(scopeAnchor(doc, posA)).toBe(cellPos);
  });
});

describe("isDraggableNode", () => {
  it("is false for the trailing empty paragraph", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("")]);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "");
    const node = doc.nodeAt(pos)!;
    expect(isDraggableNode(doc, pos, node)).toBe(false);
  });

  it("lets a plain block move", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const node = doc.nodeAt(pos)!;
    expect(isDraggableNode(doc, pos, node)).toBe(true);
  });

  it("lets a container move", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("a"));
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), grid]);
    const pos = posOf(doc, (n) => n.type === schema.nodes.grid);
    const node = doc.nodeAt(pos)!;
    expect(isDraggableNode(doc, pos, node)).toBe(true);
  });
});

describe("buildReorderTransaction - plain reorder among siblings", () => {
  it("moves a dragged paragraph after a later sibling", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    const state = stateFor(doc);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posB = posOf(doc, (n) => n.isTextblock && n.textContent === "b");

    const target: DropTarget = { kind: "after", pos: posB };
    const tr = buildReorderTransaction(state, [posA], target);
    expect(textOrder(tr.doc)).toEqual(["b", "a"]);
  });

  it("moves a dragged paragraph before an earlier sibling", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b"), paragraph("c")]);
    const state = stateFor(doc);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posC = posOf(doc, (n) => n.isTextblock && n.textContent === "c");

    const tr = buildReorderTransaction(state, [posC], { kind: "before", pos: posA });
    expect(textOrder(tr.doc)).toEqual(["c", "a", "b"]);
  });

  it("moves several dragged blocks together, preserving their relative order", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b"), paragraph("c"), paragraph("d")]);
    const state = stateFor(doc);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posC = posOf(doc, (n) => n.isTextblock && n.textContent === "c");
    const posD = posOf(doc, (n) => n.isTextblock && n.textContent === "d");

    // Drag "a" and "c" together to land after "d".
    const tr = buildReorderTransaction(state, [posC, posA], { kind: "after", pos: posD });
    expect(textOrder(tr.doc)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("buildReorderTransaction - grid targets", () => {
  it("appends a new sibling grid_item after an already-occupied one", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("existing"));
    const doc = schema.nodes.doc!.create(null, [paragraph("dragged"), grid]);
    const state = stateFor(doc);
    const draggedPos = posOf(doc, (n) => n.isTextblock && n.textContent === "dragged");
    const itemPos = posOf(doc, (n) => n.type === schema.nodes.grid_item);

    const tr = buildReorderTransaction(state, [draggedPos], { kind: "afterGridItem", pos: itemPos });
    const resultGrid = tr.doc.child(0);
    expect(resultGrid.type).toBe(schema.nodes.grid);
    expect(resultGrid.childCount).toBe(2);
    expect(resultGrid.child(0).textContent).toBe("existing");
    expect(resultGrid.child(1).textContent).toBe("dragged");
    expect(resultGrid.child(1).type).toBe(schema.nodes.grid_item);
    expect(resultGrid.child(1).attrs).toEqual({ colSpan: DEFAULT_GRID_COLUMNS, rowSpan: 1 });
  });

  it("replaces an empty grid_item's content in place, without adding a new cell", () => {
    const grid = schema.nodes.grid!.create(null, gridItem(""));
    const doc = schema.nodes.doc!.create(null, [paragraph("dragged"), grid]);
    const state = stateFor(doc);
    const draggedPos = posOf(doc, (n) => n.isTextblock && n.textContent === "dragged");
    const itemPos = posOf(doc, (n) => n.type === schema.nodes.grid_item);

    const tr = buildReorderTransaction(state, [draggedPos], { kind: "replaceGridItem", pos: itemPos });
    const resultGrid = tr.doc.child(0);
    expect(resultGrid.childCount).toBe(1);
    expect(resultGrid.child(0).textContent).toBe("dragged");
  });

  it("shrinks a grid by one item when the dragged block was that item's only content", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a"), gridItem("b")]);
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), grid]);
    const state = stateFor(doc);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posTarget = posOf(doc, (n) => n.isTextblock && n.textContent === "target");

    const tr = buildReorderTransaction(state, [posA], { kind: "after", pos: posTarget });
    const resultGridPos = posOf(tr.doc, (n) => n.type === schema.nodes.grid);
    const resultGrid = tr.doc.nodeAt(resultGridPos)!;
    expect(resultGrid.childCount).toBe(1);
    expect(resultGrid.child(0).textContent).toBe("b");
    expect(textOrder(tr.doc)).toEqual(["target", "a", "b"]);
  });

  it("removes the whole grid too once its last item is dragged out", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("solo"));
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), grid]);
    const state = stateFor(doc);
    const posSolo = posOf(doc, (n) => n.isTextblock && n.textContent === "solo");
    const posTarget = posOf(doc, (n) => n.isTextblock && n.textContent === "target");

    const tr = buildReorderTransaction(state, [posSolo], { kind: "after", pos: posTarget });
    expect(textOrder(tr.doc)).toEqual(["target", "solo"]);
    let hasGrid = false;
    tr.doc.descendants((node) => {
      if (node.type === schema.nodes.grid) hasGrid = true;
    });
    expect(hasGrid).toBe(false);
  });
});

describe("buildReorderTransaction - list targets", () => {
  it("shrinks a list by one item when the dragged block was that item's only content", () => {
    const list = schema.nodes.bullet_list!.create(null, [listItem("a"), listItem("b")]);
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), list]);
    const state = stateFor(doc);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posTarget = posOf(doc, (n) => n.isTextblock && n.textContent === "target");

    const tr = buildReorderTransaction(state, [posA], { kind: "after", pos: posTarget });
    const resultListPos = posOf(tr.doc, (n) => n.type === schema.nodes.bullet_list);
    const resultList = tr.doc.nodeAt(resultListPos)!;
    expect(resultList.childCount).toBe(1);
    expect(resultList.child(0).textContent).toBe("b");
    expect(textOrder(tr.doc)).toEqual(["target", "a", "b"]);
  });

  it("removes the whole list too once its last item is dragged out", () => {
    const list = schema.nodes.bullet_list!.create(null, listItem("solo"));
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), list]);
    const state = stateFor(doc);
    const posSolo = posOf(doc, (n) => n.isTextblock && n.textContent === "solo");
    const posTarget = posOf(doc, (n) => n.isTextblock && n.textContent === "target");

    const tr = buildReorderTransaction(state, [posSolo], { kind: "after", pos: posTarget });
    expect(textOrder(tr.doc)).toEqual(["target", "solo"]);
    let hasList = false;
    tr.doc.descendants((node) => {
      if (node.type === schema.nodes.bullet_list) hasList = true;
    });
    expect(hasList).toBe(false);
  });

  it("wraps a dropped block in a fresh list_item when the target lands directly among a list's own items", () => {
    const list = schema.nodes.bullet_list!.create(null, [listItem("a"), listItem("b")]);
    const doc = schema.nodes.doc!.create(null, [paragraph("dragged"), list]);
    const state = stateFor(doc);
    const draggedPos = posOf(doc, (n) => n.isTextblock && n.textContent === "dragged");
    const itemBPos = posOf(doc, (n) => n.type === schema.nodes.list_item && n.textContent === "b");

    const tr = buildReorderTransaction(state, [draggedPos], { kind: "before", pos: itemBPos });
    const resultList = tr.doc.child(0);
    expect(resultList.type).toBe(schema.nodes.bullet_list);
    expect(resultList.childCount).toBe(3);
    expect(resultList.child(1).type).toBe(schema.nodes.list_item);
    expect(resultList.child(1).textContent).toBe("dragged");
  });
});

describe("buildReorderTransaction - table targets", () => {
  it("inserts a dragged block directly into a table cell, no wrapper, existing content untouched", () => {
    const table = tableWithOneCell("existing");
    const doc = schema.nodes.doc!.create(null, [paragraph("dragged"), table]);
    const state = stateFor(doc);
    const draggedPos = posOf(doc, (n) => n.isTextblock && n.textContent === "dragged");
    const cellParaPos = posOf(doc, (n) => n.type === schema.nodes.paragraph && n.textContent === "existing");

    const tr = buildReorderTransaction(state, [draggedPos], { kind: "after", pos: cellParaPos });
    const cell = tr.doc.child(0).firstChild!.firstChild!;
    expect(cell.type).toBe(schema.nodes.table_cell);
    expect(cell.childCount).toBe(2);
    expect(cell.child(0).textContent).toBe("existing");
    expect(cell.child(1).textContent).toBe("dragged");
  });

  it("backfills a table cell with an empty paragraph when its only block is dragged out (never deletes the cell)", () => {
    const table = tableWithOneCell("solo");
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), table]);
    const state = stateFor(doc);
    const soloPos = posOf(doc, (n) => n.isTextblock && n.textContent === "solo");
    const targetPos = posOf(doc, (n) => n.isTextblock && n.textContent === "target");

    const tr = buildReorderTransaction(state, [soloPos], { kind: "after", pos: targetPos });
    const cellPos = posOf(tr.doc, (n) => n.type === schema.nodes.table_cell);
    const cell = tr.doc.nodeAt(cellPos)!;
    expect(cell.childCount).toBe(1);
    expect(cell.child(0).type).toBe(schema.nodes.paragraph);
    expect(cell.child(0).textContent).toBe("");
    // 3rd entry is the table's own (now-empty) textContent, not a 3rd real block.
    expect(textOrder(tr.doc)).toEqual(["target", "solo", ""]);
  });

  it('replaces a cell\'s lone empty placeholder outright ("replaceCellContent"), rather than leaving it behind as a stray sibling', () => {
    const table = tableWithEmptyCell();
    const doc = schema.nodes.doc!.create(null, [paragraph("dragged"), table]);
    const state = stateFor(doc);
    const draggedPos = posOf(doc, (n) => n.isTextblock && n.textContent === "dragged");
    const placeholderPos = posOf(doc, (n) => n.type === schema.nodes.paragraph && n.content.size === 0);

    const tr = buildReorderTransaction(state, [draggedPos], { kind: "replaceCellContent", pos: placeholderPos });
    const cell = tr.doc.child(0).firstChild!.firstChild!;
    expect(cell.type).toBe(schema.nodes.table_cell);
    expect(cell.childCount).toBe(1);
    expect(cell.child(0).textContent).toBe("dragged");
  });
});

describe("buildDeleteTransaction", () => {
  it("deletes a single top-level block", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    const state = stateFor(doc);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");

    const tr = buildDeleteTransaction(state, [posA]);
    expect(textOrder(tr.doc)).toEqual(["b"]);
  });

  it("deletes several selected blocks together", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b"), paragraph("c")]);
    const state = stateFor(doc);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posC = posOf(doc, (n) => n.isTextblock && n.textContent === "c");

    const tr = buildDeleteTransaction(state, [posC, posA]);
    expect(textOrder(tr.doc)).toEqual(["b"]);
  });

  it("cascades away an emptied grid entirely, same as dragging its last item out", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("solo"));
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), grid]);
    const state = stateFor(doc);
    const soloPos = posOf(doc, (n) => n.isTextblock && n.textContent === "solo");

    const tr = buildDeleteTransaction(state, [soloPos]);
    expect(textOrder(tr.doc)).toEqual(["target"]);
  });

  it("backfills a table cell with an empty paragraph rather than deleting the cell", () => {
    const table = tableWithOneCell("solo");
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), table]);
    const state = stateFor(doc);
    const soloPos = posOf(doc, (n) => n.isTextblock && n.textContent === "solo");

    const tr = buildDeleteTransaction(state, [soloPos]);
    const cellPos = posOf(tr.doc, (n) => n.type === schema.nodes.table_cell);
    const cell = tr.doc.nodeAt(cellPos)!;
    expect(cell.childCount).toBe(1);
    expect(cell.child(0).textContent).toBe("");
  });

  it("leaves a single empty paragraph behind when every block is deleted", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("only")]);
    const state = stateFor(doc);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "only");

    const tr = buildDeleteTransaction(state, [pos]);
    expect(tr.doc.childCount).toBe(1);
    expect(tr.doc.child(0).type).toBe(schema.nodes.paragraph);
    expect(tr.doc.child(0).textContent).toBe("");
  });
});

describe("deleteSelectedBlocks", () => {
  it("is a no-op while reorder mode is inactive", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a")]);
    const state = stateFor(doc);
    let dispatched = false;
    const result = deleteSelectedBlocks()(state, () => {
      dispatched = true;
    });
    expect(result).toBe(false);
    expect(dispatched).toBe(false);
  });

  it("is a no-op while active but nothing is selected", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a")]);
    let state = stateFor(doc);
    state = runMeta(state, { toggle: true });
    let dispatched = false;
    const result = deleteSelectedBlocks()(state, () => {
      dispatched = true;
    });
    expect(result).toBe(false);
    expect(dispatched).toBe(false);
  });

  it("deletes the selection and clears it", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    let state = stateFor(doc);
    state = runMeta(state, { toggle: true });
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    state = runMeta(state, { setSelected: [posA] });

    let tr: Transaction | null = null;
    const result = deleteSelectedBlocks()(state, (t) => (tr = t));
    expect(result).toBe(true);
    const next = state.apply(tr!);
    expect(textOrder(next.doc)).toEqual(["b"]);
    expect(getReorderSelection(next)).toEqual([]);
  });
});

describe("initialDropTarget", () => {
  it("anchors before the sibling right after the dragged range - its own resting slot", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b"), paragraph("c")]);
    const posB = posOf(doc, (n) => n.isTextblock && n.textContent === "b");
    const posC = posOf(doc, (n) => n.isTextblock && n.textContent === "c");
    expect(initialDropTarget(doc, [posB])).toEqual({ kind: "before", pos: posC });
  });

  it("falls back to after the preceding sibling when the dragged range is the parent's last child", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b")]);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posB = posOf(doc, (n) => n.isTextblock && n.textContent === "b");
    expect(initialDropTarget(doc, [posB])).toEqual({ kind: "after", pos: posA });
  });

  it("returns null when the dragged range has no siblings at all", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("only")]);
    const pos = posOf(doc, (n) => n.isTextblock && n.textContent === "only");
    expect(initialDropTarget(doc, [pos])).toBeNull();
  });

  it("skips the hidden trailing landing-spot paragraph as a candidate, falling back to the preceding sibling", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b"), paragraph("")]);
    const posA = posOf(doc, (n) => n.isTextblock && n.textContent === "a");
    const posB = posOf(doc, (n) => n.isTextblock && n.textContent === "b");
    expect(initialDropTarget(doc, [posB])).toEqual({ kind: "after", pos: posA });
  });

  it("spans a multi-position selection from its first to its last position", () => {
    const doc = schema.nodes.doc!.create(null, [paragraph("a"), paragraph("b"), paragraph("c"), paragraph("d")]);
    const posB = posOf(doc, (n) => n.isTextblock && n.textContent === "b");
    const posC = posOf(doc, (n) => n.isTextblock && n.textContent === "c");
    const posD = posOf(doc, (n) => n.isTextblock && n.textContent === "d");
    expect(initialDropTarget(doc, [posC, posB])).toEqual({ kind: "before", pos: posD });
  });

  it("anchors to a sibling within a table cell, not the whole table", () => {
    const table = schema.nodes.table!.create(
      { caption: "", colWidths: null },
      schema.nodes.table_row!.create(
        null,
        schema.nodes.table_cell!.create(null, [paragraph("first"), paragraph("second")]),
      ),
    );
    const doc = schema.nodes.doc!.create(null, [paragraph("target"), table]);
    const posFirst = posOf(doc, (n) => n.isTextblock && n.textContent === "first");
    const posSecond = posOf(doc, (n) => n.isTextblock && n.textContent === "second");
    expect(initialDropTarget(doc, [posFirst])).toEqual({ kind: "before", pos: posSecond });
  });
});
