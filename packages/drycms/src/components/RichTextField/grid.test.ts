import { describe, expect, it } from "vitest";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { exportCleanHtml } from "./html.js";
import {
  exitGridDownward,
  getFocusedGridItem,
  getSelectedGrid,
  insertBlockAfterFocusedGridItem,
  insertGrid,
  removeGrid,
  setGridColumns,
  splitGridItem,
} from "./grid.js";
import { DEFAULT_GRID_COLUMNS, schema } from "./schema.js";

/** Minimal stand-in for the one `EditorView` method `exitGridDownward`
 * reads (`endOfTextblock`) - real `EditorView`s need a mounted DOM to
 * answer that, which this DOM-free test file doesn't have (see the file
 * doc comment below); faking just that one method is enough to exercise
 * the command's own doc-structure logic without pulling in jsdom. */
function fakeView(atEndOfTextblock: boolean): EditorView {
  return { endOfTextblock: () => atEndOfTextblock } as unknown as EditorView;
}

/**
 * Covers the DOM-free half of this feature: `grid.ts`'s commands (plain
 * `prosemirror-model`/`-state`, no DOM involved) and `html.ts`'s export
 * side (pure string building from a `PMNode`). The import side
 * (`importCleanHtml`/`importGridElement`) goes through `DOMParser`, which
 * this repo has no jsdom/happy-dom dependency to run under vitest - same
 * gap every other DOM-touching part of `RichTextField` already has (there
 * are no existing unit tests for `table`/`image` either); that side is
 * covered by the real-browser Playwright check instead, not duplicated
 * here with a new test-only dependency.
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

function runCommand(state: EditorState, command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) {
  let tr: Transaction | null = null;
  const ok = command(state, (t) => (tr = t));
  return { ok, tr: tr as Transaction | null, next: tr ? state.apply(tr as Transaction) : state };
}

describe("insertGrid", () => {
  it("inserts a grid with one default full-width item", () => {
    const doc = schema.nodes.doc!.create(null, paragraph(""));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, insertGrid());
    const grid = next.doc.firstChild!;
    expect(grid.type).toBe(schema.nodes.grid);
    expect(grid.childCount).toBe(1);
    expect(grid.firstChild!.type).toBe(schema.nodes.grid_item);
    expect(grid.firstChild!.attrs).toEqual({ colSpan: DEFAULT_GRID_COLUMNS, rowSpan: 1 });
  });

  it("nests a new grid inside an empty cell, replacing its content in place", () => {
    const grid = schema.nodes.grid!.create(null, gridItem(""));
    const doc = schema.nodes.doc!.create(null, grid);
    // Position inside the (empty) cell's own paragraph.
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    const { next } = runCommand(state, insertGrid());
    const outerGrid = next.doc.firstChild!;
    expect(outerGrid.childCount).toBe(1);
    const innerGrid = outerGrid.firstChild!.firstChild!;
    expect(innerGrid.type).toBe(schema.nodes.grid);
    expect(innerGrid.firstChild!.type).toBe(schema.nodes.grid_item);
  });

  it("nests a new grid in a fresh sibling cell when the current one already has content", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("existing"));
    const doc = schema.nodes.doc!.create(null, grid);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    const { next } = runCommand(state, insertGrid());
    const outerGrid = next.doc.firstChild!;
    expect(outerGrid.childCount).toBe(2);
    expect(outerGrid.child(0).textContent).toBe("existing");
    expect(outerGrid.child(1).firstChild!.type).toBe(schema.nodes.grid);
  });
});

describe("insertBlockAfterFocusedGridItem", () => {
  it("returns null outside a grid", () => {
    const doc = schema.nodes.doc!.create(null, paragraph("plain"));
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    expect(insertBlockAfterFocusedGridItem(state, paragraph("new"))).toBeNull();
  });

  it("replaces an empty cell's own block directly, without adding a new cell", () => {
    const grid = schema.nodes.grid!.create(null, gridItem(""));
    const doc = schema.nodes.doc!.create(null, grid);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    const tr = insertBlockAfterFocusedGridItem(state, paragraph("replaced"))!;
    const resultGrid = tr.doc.firstChild!;
    expect(resultGrid.childCount).toBe(1);
    expect(resultGrid.firstChild!.textContent).toBe("replaced");
  });

  it("appends a new sibling cell when the focused one already has content", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("existing"));
    const doc = schema.nodes.doc!.create(null, grid);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    const tr = insertBlockAfterFocusedGridItem(state, paragraph("new"))!;
    const resultGrid = tr.doc.firstChild!;
    expect(resultGrid.childCount).toBe(2);
    expect(resultGrid.child(0).textContent).toBe("existing");
    expect(resultGrid.child(1).textContent).toBe("new");
    expect(resultGrid.child(1).attrs).toEqual({ colSpan: DEFAULT_GRID_COLUMNS, rowSpan: 1 });
  });
});

describe("removeGrid", () => {
  it("unwraps every item's inner block back into the surrounding flow", () => {
    const grid = schema.nodes.grid!.create(null, [
      gridItem("a", { colSpan: 6 }),
      gridItem("b", { colSpan: 6, rowSpan: 2 }),
    ]);
    const doc = schema.nodes.doc!.create(null, [paragraph("before"), grid, paragraph("after")]);
    const state = EditorState.create({ schema, doc });
    const gridPos = doc.firstChild!.nodeSize; // after "before" paragraph
    const { next } = runCommand(state, removeGrid(gridPos, grid));

    const texts: string[] = [];
    next.doc.forEach((node) => texts.push(node.textContent));
    expect(texts).toEqual(["before", "a", "b", "after"]);
    // The unwrapped nodes are plain paragraphs again, not grid_items.
    expect(next.doc.child(1).type).toBe(schema.nodes.paragraph);
    expect(next.doc.child(2).type).toBe(schema.nodes.paragraph);
  });
});

describe("setGridColumns", () => {
  it("updates the grid's own columns attr and rescales every item's colSpan proportionally (columns increasing)", () => {
    const grid = schema.nodes.grid!.create({ columns: 4 }, [gridItem("a", { colSpan: 2 }), gridItem("b", { colSpan: 4 })]);
    const doc = schema.nodes.doc!.create(null, grid);
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setGridColumns(0, grid, 12));

    const resultGrid = next.doc.firstChild!;
    expect(resultGrid.attrs.columns).toBe(12);
    // Half-width (2/4) stays half-width (6/12); full-width (4/4) stays full-width (12/12).
    expect(resultGrid.child(0).attrs.colSpan).toBe(6);
    expect(resultGrid.child(1).attrs.colSpan).toBe(12);
  });

  it("updates the grid's own columns attr and rescales every item's colSpan proportionally (columns decreasing)", () => {
    const grid = schema.nodes.grid!.create({ columns: 12 }, [gridItem("a", { colSpan: 12 }), gridItem("b", { colSpan: 6 })]);
    const doc = schema.nodes.doc!.create(null, grid);
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setGridColumns(0, grid, 4));

    const resultGrid = next.doc.firstChild!;
    expect(resultGrid.attrs.columns).toBe(4);
    // Full-width (12/12) stays full-width (4/4); half-width (6/12) stays half-width (2/4).
    expect(resultGrid.child(0).attrs.colSpan).toBe(4);
    expect(resultGrid.child(1).attrs.colSpan).toBe(2);
  });

  it("rounds to the nearest whole column and never exceeds the new column count", () => {
    const grid = schema.nodes.grid!.create({ columns: 12 }, gridItem("a", { colSpan: 5 }));
    const doc = schema.nodes.doc!.create(null, grid);
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setGridColumns(0, grid, 4));

    // 5/12 of 4 columns = 1.67, rounds to 2.
    expect(next.doc.firstChild!.child(0).attrs.colSpan).toBe(2);
  });
});

describe("getSelectedGrid / getFocusedGridItem", () => {
  it("finds the grid/item containing the selection, and null outside one", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a"), gridItem("b", { colSpan: 4 })]);
    const doc = schema.nodes.doc!.create(null, [paragraph("before"), grid]);
    // Position inside the 2nd item's paragraph text ("b").
    const gridPos = doc.firstChild!.nodeSize;
    const firstItemSize = grid.firstChild!.nodeSize;
    // +1 into the grid, skip item 1 entirely, +1 into item 2, +1 into its
    // paragraph's own text content.
    const posInsideSecondItem = gridPos + 1 + firstItemSize + 1 + 1;
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, posInsideSecondItem),
    });

    const selectedGrid = getSelectedGrid(state);
    expect(selectedGrid?.pos).toBe(gridPos);
    const focused = getFocusedGridItem(state);
    expect(focused?.node.textContent).toBe("b");
    expect(focused?.node.attrs.colSpan).toBe(4);

    const outsideState = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1) });
    expect(getSelectedGrid(outsideState)).toBeNull();
    expect(getFocusedGridItem(outsideState)).toBeNull();
  });
});

describe("exitGridDownward", () => {
  it("moves out of the grid's last item, adding a trailing paragraph when the grid is the last thing in the doc", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a"), gridItem("b")]);
    const doc = schema.nodes.doc!.create(null, grid);
    const firstItemSize = grid.firstChild!.nodeSize;
    // Same "+1 into the grid, skip item 1, +1 into item 2, +1 into its
    // paragraph" math as the getSelectedGrid/getFocusedGridItem test above.
    const posInLastItem = 0 + 1 + firstItemSize + 1 + 1;
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, posInLastItem) });

    let tr: Transaction | null = null;
    const ok = exitGridDownward()(state, (t) => (tr = t), fakeView(true));
    expect(ok).toBe(true);
    const nextDoc = tr!.doc;
    expect(nextDoc.lastChild!.type).toBe(schema.nodes.paragraph);
    expect(nextDoc.lastChild!.content.size).toBe(0);
  });

  it("declines from an item that isn't the grid's last one, even at the end of its own textblock", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a"), gridItem("b")]);
    const doc = schema.nodes.doc!.create(null, grid);
    // Inside item 1's ("a") text - not the last item.
    const posInFirstItem = 0 + 1 + 1 + 1;
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, posInFirstItem) });
    expect(exitGridDownward()(state, undefined, fakeView(true))).toBe(false);
  });

  it("declines when not at the end of its own textblock, even in the last item", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a"), gridItem("b")]);
    const doc = schema.nodes.doc!.create(null, grid);
    const firstItemSize = grid.firstChild!.nodeSize;
    const posInLastItem = 0 + 1 + firstItemSize + 1 + 1;
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, posInLastItem) });
    expect(exitGridDownward()(state, undefined, fakeView(false))).toBe(false);
  });

  it("declines outside a grid entirely", () => {
    const doc = schema.nodes.doc!.create(null, paragraph("plain"));
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    expect(exitGridDownward()(state, undefined, fakeView(true))).toBe(false);
  });
});

describe("splitGridItem", () => {
  it("splits the text at the cursor into a new sibling item, reset to default span", () => {
    const grid = schema.nodes.grid!.create(null, gridItem("helloworld", { colSpan: 8, rowSpan: 2 }));
    const doc = schema.nodes.doc!.create(null, grid);
    // doc(0) grid(1) grid_item(2) paragraph(3) "hello|world" -> split after "hello"
    const splitPos = 3 + "hello".length;
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, splitPos) });

    const { ok, next } = runCommand(state, splitGridItem());
    expect(ok).toBe(true);
    const resultGrid = next.doc.firstChild!;
    expect(resultGrid.childCount).toBe(2);
    expect(resultGrid.child(0).textContent).toBe("hello");
    expect(resultGrid.child(0).attrs).toEqual({ colSpan: 8, rowSpan: 2 });
    expect(resultGrid.child(1).textContent).toBe("world");
    expect(resultGrid.child(1).attrs).toEqual({ colSpan: DEFAULT_GRID_COLUMNS, rowSpan: 1 });
  });

  it("declines outside a grid item, leaving default Enter handling to run instead", () => {
    const doc = schema.nodes.doc!.create(null, paragraph("plain"));
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) });
    const { ok, tr } = runCommand(state, splitGridItem());
    expect(ok).toBe(false);
    expect(tr).toBeNull();
  });
});

describe("exportCleanHtml", () => {
  it("renders a grid as a dry-tx-grid div with unwrapped children - non-default items get an inline style, default ones don't", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a", { colSpan: 2, rowSpan: 2 }), gridItem("b")]);
    const doc = schema.nodes.doc!.create(null, grid);
    const html = exportCleanHtml(doc);

    expect(html).toBe(
      '<div class="dry-tx-grid" style="display:grid;grid-template-columns:repeat(4,1fr);grid-auto-flow:row;grid-auto-rows:minmax(1.3125rem,auto)">' +
        "<style>.dry-tx-grid>*{grid-column:span 4;grid-row:span 1}" +
        "@media (width < 48rem){.dry-tx-grid>*{grid-column:span 4 !important;grid-row:span 1 !important}}</style>" +
        '<p style="grid-column:span 2;grid-row:span 2">a</p>' +
        "<p>b</p>" +
        "</div>",
    );
  });

  it("uses the grid's own columns attr (not the fixed default) for the container and default-item styles", () => {
    const grid = schema.nodes.grid!.create({ columns: 12 }, gridItem("a", { colSpan: 12 }));
    const doc = schema.nodes.doc!.create(null, grid);
    const html = exportCleanHtml(doc);

    expect(html).toBe(
      '<div class="dry-tx-grid" style="display:grid;grid-template-columns:repeat(12,1fr);grid-auto-flow:row;grid-auto-rows:minmax(1.3125rem,auto)">' +
        "<style>.dry-tx-grid>*{grid-column:span 12;grid-row:span 1}" +
        "@media (width < 48rem){.dry-tx-grid>*{grid-column:span 12 !important;grid-row:span 1 !important}}</style>" +
        "<p>a</p>" +
        "</div>",
    );
  });

  it("merges a grid item's span onto that block's own tag (e.g. a table), not a wrapper", () => {
    const table = schema.nodes.table!.create(
      { caption: "", colWidths: null },
      schema.nodes.table_row!.create(null, schema.nodes.table_cell!.createAndFill()!),
    );
    const grid = schema.nodes.grid!.create(
      null,
      schema.nodes.grid_item!.create({ colSpan: 2, rowSpan: 1 }, table),
    );
    const doc = schema.nodes.doc!.create(null, grid);
    expect(exportCleanHtml(doc)).toContain('<table style="grid-column:span 2;grid-row:span 1">');
  });
});
