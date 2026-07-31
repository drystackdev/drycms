import type { Attrs, Node as PMNode, NodeType } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { Selection } from "prosemirror-state";
import { canSplit } from "prosemirror-transform";
import { DEFAULT_GRID_COLUMNS, schema } from "./schema.js";

/**
 * Grid-specific commands - mirrors `table.ts`'s shape (insert/remove/
 * getSelectedX), but far shorter: with layout living entirely on
 * `grid_item`'s own `colSpan`/`rowSpan` attrs (see `schema.ts`), there's no
 * table-style side-table (`colWidths` array, `TableMap`) to keep in sync -
 * every command below only ever touches the one node it's already looking
 * at. Rows aren't tracked as a count anywhere in this file either - native
 * CSS grid auto-placement (`gridContainerStyleString`) sizes rows on its own
 * from each item's `rowSpan`, so there's nothing here to compute or store
 * for that.
 */

/** A full-width, single-row `grid_item`'s attrs for a grid with `columns`
 * columns - every command below that creates a brand-new item (rather than
 * resizing an existing one) uses this, matching `splitGridItem`'s own reset-
 * to-default convention. Takes `columns` as a param rather than a fixed
 * constant since each grid instance now owns its own column count (see
 * `schema.ts`'s `grid` node spec). */
function defaultItemAttrs(columns: number) {
  return { colSpan: columns, rowSpan: 1 };
}

/** Meta key `insertGrid` stamps onto its own transaction with the doc
 * position of the grid it just inserted - `grid-resize.ts`'s plugin reads
 * this to default a freshly-inserted grid's `highlightLine` to on, without
 * grid.ts needing to import that plugin back (which would make the 2 files'
 * existing one-way `grid-resize.ts` → `grid.ts` dependency circular). Any
 * plugin can read a `tr.getMeta` key regardless of which file set it -
 * that's the point of routing this through plain transaction meta instead
 * of a direct call. */
export const GRID_INSERTED_META = "gridInsertedAt";

function buildGrid(columns: number = DEFAULT_GRID_COLUMNS): PMNode {
  const gridItem = schema.nodes.grid_item!.create(defaultItemAttrs(columns), schema.nodes.paragraph!.createAndFill()!);
  return schema.nodes.grid!.create({ columns }, gridItem);
}

/** Inserts a fresh grid (one default full-width item) at the selection -
 * mirrors `insertTable`'s own trailing-paragraph fix-up for the same reason:
 * without it, a grid inserted at the very end of the document leaves the
 * cursor nowhere to go afterward.
 *
 * Nested grids (a grid inside another grid's cell) go through
 * `insertBlockAfterFocusedGridItem` below, same as `table.ts`'s
 * `insertTable` - see that function's own doc comment for why plain
 * `replaceSelectionWith` can't be trusted to land the new grid inside the
 * cell the user actually clicked into. */
export function insertGrid(): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const gridNode = buildGrid();
      // `replaceSelectionWith` can widen the actual replaced range past the
      // selection itself (e.g. a collapsed selection at the very start of a
      // paragraph consumes that paragraph's own opening boundary too, to
      // avoid leaving an empty one behind) - mapping the pre-transaction
      // selection position through the transform doesn't reliably land on
      // the inserted node's own position as a result (confirmed via a unit
      // test: it landed inside unrelated, untouched text further down the
      // doc). Finding the grid by object identity in the resulting doc
      // instead sidesteps that entirely - `Node`s are immutable, and
      // neither insertion path below needs to rebuild `gridNode` itself, so
      // the exact same reference ends up in `tr.doc` either way. A grid
      // landing at the very end of the doc is left to
      // `trailing-paragraph.ts`'s standing invariant plugin to give the
      // cursor somewhere to go afterward, rather than this command
      // re-deriving that case itself.
      let tr = insertBlockAfterFocusedGridItem(state, gridNode) ?? state.tr.replaceSelectionWith(gridNode);
      let gridPos: number | null = null;
      tr.doc.descendants((node, pos) => {
        if (gridPos != null) return false;
        if (node === gridNode) gridPos = pos;
        return gridPos == null;
      });
      if (gridPos != null) tr = tr.setMeta(GRID_INSERTED_META, gridPos);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Removes the grid at `pos`, keeping its contents - unwraps every
 * `grid_item` down to the one block it holds and splices those directly
 * into the surrounding flow, discarding only the grid/grid_item wrapper
 * nodes and their layout attrs. Unlike `removeTable`, there's no "whole doc
 * is just this node" guard needed: `grid_item+` requires at least one item,
 * and each item requires exactly one block, so `blocks` here is always
 * non-empty - the unwrapped content alone already satisfies `doc`'s own
 * `block+`. */
export function removeGrid(pos: number, node: PMNode): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const blocks: PMNode[] = [];
      node.forEach((gridItem) => {
        if (gridItem.firstChild) blocks.push(gridItem.firstChild);
      });
      const tr = state.tr.replaceWith(pos, pos + node.nodeSize, Fragment.from(blocks));
      dispatch(tr);
    }
    return true;
  };
}

/** Changes the grid at `pos`'s own `columns` attr (`grid-menu.tsx`'s columns
 * popover - one of `GRID_COLUMN_OPTIONS` in `schema.ts`, though this command
 * itself doesn't enforce that set) - and rescales every item's `colSpan`
 * proportionally along with it, so e.g. a half-width item stays roughly
 * half-width rather than suddenly occupying a very different fraction of
 * the row (going 4→12 columns unscaled would shrink a `colSpan:2` item from
 * "half the row" down to "a sixth of it"). Rounds to the nearest whole
 * column and clamps into `[1, columns]` - `grid-column: span N` with `N`
 * greater than the container's own `grid-template-columns` count spills
 * into extra implicit columns the browser creates on the fly, breaking the
 * layout rather than just looking wrong. */
export function setGridColumns(pos: number, node: PMNode, columns: number): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const oldColumns = node.attrs.columns as number;
      let tr = state.tr.setNodeAttribute(pos, "columns", columns);
      node.forEach((item, offset) => {
        const colSpan = item.attrs.colSpan as number;
        const scaled = oldColumns > 0 ? Math.round((colSpan * columns) / oldColumns) : columns;
        const newColSpan = Math.min(columns, Math.max(1, scaled));
        if (newColSpan !== colSpan) tr = tr.setNodeAttribute(pos + 1 + offset, "colSpan", newColSpan);
      });
      dispatch(tr);
    }
    return true;
  };
}

/** Drives `grid-menu.tsx`'s visibility/anchor - the grid containing the
 * selection's top-level position, if any. Same "walk `$from`'s ancestors"
 * shape as `getSelectedTable` in `table.ts`. */
export function getSelectedGrid(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.grid) return { pos: $from.before(d), node };
  }
  return null;
}

/** The `grid_item` containing the selection, if any - drives
 * `grid-resize.ts`'s "which item are the 2 resize handles anchored to"
 * decoration. */
export function getFocusedGridItem(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.grid_item) return { pos: $from.before(d), node };
  }
  return null;
}

/** Inserts `block` as a brand-new sibling `grid_item` (reset to the
 * default full-width/single-row span, matching `splitGridItem`'s own
 * convention) right after the grid cell the selection is currently focused
 * on, if any - `null` when the selection isn't inside a grid at all, so
 * callers fall back to their own normal insertion unchanged.
 *
 * Exists because a plain `replaceSelectionWith`-based insert command (so
 * far, only `table.ts`'s `insertTable`) has no idea `grid_item`'s content
 * is exactly one block (schema.ts), not `block+` like a list item's - left
 * to its own generic fitting logic, inserting a 2nd block there is
 * structurally invalid at that depth, so the browser/PM insert keeps
 * widening the replaced range hunting for *some* valid ancestor to fit it,
 * and - confirmed empirically, for both an empty and a non-empty cell -
 * can walk all the way past the whole grid's own boundary too, landing the
 * table as a top-level sibling after the grid entirely rather than inside
 * the cell the user actually clicked into.
 *
 * If the focused cell's own block is already empty (its default just-
 * created state, or emptied back out by the user), `block` replaces it
 * directly in place instead - no need for a whole new cell when there's
 * nothing there to lose either way. Otherwise, appends `block` as a new
 * sibling cell right after the current one, leaving that existing content
 * completely untouched rather than risking silently discarding it. */
export function insertBlockAfterFocusedGridItem(state: EditorState, block: PMNode): Transaction | null {
  const focused = getFocusedGridItem(state);
  if (!focused) return null;
  const inner = focused.node.firstChild;
  if (inner && inner.content.size === 0) {
    const innerStart = focused.pos + 1;
    return state.tr.replaceWith(innerStart, innerStart + inner.nodeSize, block);
  }
  const columns = (getSelectedGrid(state)?.node.attrs.columns as number | undefined) ?? DEFAULT_GRID_COLUMNS;
  const newItem = schema.nodes.grid_item!.create(defaultItemAttrs(columns), block);
  return state.tr.insert(focused.pos + focused.node.nodeSize, newItem);
}

/** `Enter` inside a grid: `grid_item.content` is exactly one block
 * (cardinality 1, see `schema.ts`), so the default Enter handling (which
 * would just split the current textblock into two siblings under the same
 * parent) isn't legal here - same reason `list_item` needs `splitListItem`
 * instead of relying on default Enter. Splits 2 levels up (through the
 * textblock, then through `grid_item`) in one `tr.split`, so the second half
 * lands in a brand-new sibling `grid_item` reset to the default full-width/
 * single-row span - matching `insertGrid`'s own default, rather than
 * inheriting whatever span the original item had been resized to. Declines
 * (returns `false`, letting the keymap chain fall through) whenever the
 * selection isn't a single collapsed-or-ranged spot directly inside a
 * `grid_item`'s own textblock - e.g. inside a list or table nested in a grid
 * cell, which `splitListItem`/`prosemirror-tables`' own handling already
 * cover and must run instead (see the `Enter` keymap in
 * `useRichTextEditor.ts`, chained before this command). */
export function splitGridItem(): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!$from.sameParent($to) || $from.depth < 2) return false;
    if (!$from.parent.isTextblock) return false;
    if ($from.node($from.depth - 1).type !== schema.nodes.grid_item) return false;
    const grid = $from.node($from.depth - 2);
    if (grid?.type !== schema.nodes.grid) return false;

    // `typesAfter` is ordered outermost-split-level first (index 0 = the
    // `grid_item` boundary, index 1 = the textblock boundary) - matches
    // `prosemirror-schema-list`'s own `splitListItem`, whose `types` array
    // puts `itemType` (its outer level) at index 0 and the inner textblock's
    // type at index 1.
    const typesAfter: ({ type: NodeType; attrs?: Attrs | null } | null)[] = [
      { type: schema.nodes.grid_item!, attrs: defaultItemAttrs(grid.attrs.columns as number) },
      null,
    ];
    if (!canSplit(state.doc, $from.pos, 2, typesAfter)) return false;
    if (dispatch) {
      let tr = state.tr.deleteSelection();
      tr = tr.split(tr.mapping.map($from.pos), 2, typesAfter);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Shared by `exitGridDownward` below - same shape as `table.ts`'s own
 * `moveAfterTable`: moves the selection into whatever follows `grid` at
 * `pos`. Relies on `trailing-paragraph.ts`'s standing invariant to
 * guarantee there's always something there even when the grid is the very
 * last thing in the document, rather than checking for that case itself. */
function moveAfterGrid(state: EditorState, dispatch: (tr: Transaction) => void, grid: { pos: number; node: PMNode }) {
  const after = grid.pos + grid.node.nodeSize;
  const selection = Selection.near(state.doc.resolve(after), 1);
  dispatch(state.tr.setSelection(selection).scrollIntoView());
}

/** `ArrowDown` in a grid's own last item (in document order), once the
 * caret's already on the last visual line of its own cell - same "nowhere
 * further to go, so leave the container" idea as `table.ts`'s own
 * `exitTableDownward`. Anchored to document order (not an on-screen
 * "bottommost" check like table's own `TableMap`-based `rect.bottom ===
 * rect.map.height`) - a grid's items can sit side by side via `colSpan`,
 * and there's no grid equivalent of `TableMap` to resolve true 2-D
 * position from; document order is a reasonable approximation for the one
 * case this actually needs to handle (leaving the grid entirely once
 * there's truly nothing after it), not a claim that arrow-key movement
 * between side-by-side cells is otherwise grid-aware. */
export function exitGridDownward(): Command {
  return (state, dispatch, view) => {
    const selected = getSelectedGrid(state);
    if (!selected) return false;
    if (!view || !view.endOfTextblock("down")) return false;
    const focused = getFocusedGridItem(state);
    if (!focused) return false;
    const isLastItem = focused.pos + focused.node.nodeSize === selected.pos + selected.node.nodeSize - 1;
    if (!isLastItem) return false;
    if (dispatch) moveAfterGrid(state, dispatch, selected);
    return true;
  };
}
