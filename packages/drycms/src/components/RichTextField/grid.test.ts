import { describe, expect, it } from "vitest";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { exportCleanHtml } from "./html.js";
import { getFocusedGridItem, getSelectedGrid, insertGrid, removeGrid, splitGridItem } from "./grid.js";
import { GRID_COLUMNS, schema } from "./schema.js";

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
    { colSpan: attrs?.colSpan ?? GRID_COLUMNS, rowSpan: attrs?.rowSpan ?? 1 },
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
    expect(grid.firstChild!.attrs).toEqual({ colSpan: GRID_COLUMNS, rowSpan: 1 });
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
    expect(resultGrid.child(1).attrs).toEqual({ colSpan: GRID_COLUMNS, rowSpan: 1 });
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
  it("renders a grid as a dry-tx-grid div of dry-tx-grid-item divs, span styles always explicit", () => {
    const grid = schema.nodes.grid!.create(null, [gridItem("a", { colSpan: 6, rowSpan: 2 }), gridItem("b")]);
    const doc = schema.nodes.doc!.create(null, grid);
    const html = exportCleanHtml(doc);
    expect(html).toBe(
      '<div class="dry-tx-grid" style="display:grid;grid-template-columns:repeat(12,1fr);grid-auto-flow:row">' +
        '<div class="dry-tx-grid-item" style="grid-column:span 6;grid-row:span 2"><p>a</p></div>' +
        '<div class="dry-tx-grid-item" style="grid-column:span 12;grid-row:span 1"><p>b</p></div>' +
        "</div>",
    );
  });
});
