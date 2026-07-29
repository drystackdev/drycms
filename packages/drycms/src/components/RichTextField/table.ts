import type { Node as PMNode } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { Selection } from "prosemirror-state";
import { TableMap, addColumn, isInTable, mergeCells, removeColumn, selectedRect, splitCellWithType } from "prosemirror-tables";
import { schema } from "./schema.js";

/**
 * Table-specific commands not already covered by `prosemirror-tables`
 * (`table-menu.tsx` imports `addRowAfter`/`addRowBefore`/`deleteRow`/
 * `toggleHeaderRow` straight from that package - row operations never touch
 * `colWidths`, so they need no wrapping). Column insert/delete *do* need a
 * wrapper here: `colWidths` (schema.ts) is a table-level array of one
 * percentage per grid column, so adding/removing a column has to keep that
 * array's length in sync in the same transaction - `addColumn`/`removeColumn`
 * (the lower-level, `tr`-taking functions, unlike the state-based
 * `addColumnBefore`/`deleteColumn` commands) are what make that possible.
 * Merge/split (`mergeCells` from the package, `unmergeCell` below) rely on
 * the `colspan`/`rowspan` attrs `tableNodes()` already generates for every
 * cell - this field's cells are no longer guaranteed `colspan`/`rowspan` 1
 * now that merge ships.
 */

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

function buildTable(rows: number, cols: number): PMNode {
  const cellType = schema.nodes.table_cell!;
  const headerType = schema.nodes.table_header!;
  const rowType = schema.nodes.table_row!;
  const buildRow = (header: boolean) =>
    rowType.create(null, Array.from({ length: cols }, () => (header ? headerType : cellType).createAndFill()!));
  const bodyRowCount = Math.max(rows - 1, 0);
  return schema.nodes.table!.create(null, [buildRow(true), ...Array.from({ length: bodyRowCount }, () => buildRow(false))]);
}

/** Inserts a fresh `rows`x`cols` table at the selection, header row on by
 * default (first row's cells are `table_header`, matching the "table mặc
 * định bật header" requirement) - `table-insert-button.tsx`'s 6x6 grid
 * picker passes the size the user hovered; resizing afterward happens via
 * `table-menu.tsx`'s insert row/column actions. Also appends an empty
 * paragraph after the table if the selection sat at the very end of the
 * document - `Selection.atEnd(state.doc)` is the innermost end position
 * (it descends into whatever the last leaf/textblock actually is), unlike
 * a raw `state.doc.content.size` comparison: a cursor resting at the end
 * of the last textblock's own text sits one position *before* that (every
 * enclosing node it's inside still needs its own closing token counted),
 * so comparing directly against `content.size` never matches and silently
 * skips the very case this is for. Without this fix-up, a table inserted
 * at the end of the document leaves nothing after it for the cursor to
 * move into, silently swallowing anything typed next. Any other insertion
 * position already gets a sibling for free, whether that's the existing
 * block that followed the cursor or the tail end of a split paragraph, so
 * this only ever fires for the trailing case. */
export function insertTable(rows = DEFAULT_ROWS, cols = DEFAULT_COLS): Command {
  return (state, dispatch) => {
    if (dispatch) {
      let tr = state.tr.replaceSelectionWith(buildTable(rows, cols));
      if (Selection.atEnd(state.doc).from === state.selection.to) {
        tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph!.createAndFill()!);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Deletes the table at `pos`, plus any empty paragraph(s) immediately
 * following it - the trailing paragraph `insertTable` above adds so the
 * cursor has somewhere to land, cleaned back up if the table's removed
 * before that paragraph ever picks up real content (checked by
 * `content.size === 0`, not just "is a paragraph" - a paragraph the user
 * actually typed into is content, not table debris). Keeps extending the
 * removed range as long as the next node is still an empty paragraph,
 * since nothing rules out more than one accumulating - all read off the
 * original, untouched `state.doc` before any deletion happens. Table-
 * specific rather than folded into `commands.ts`'s generic `removeNodeAt`
 * (which `image-menu.tsx`'s own "Remove image" button still uses as-is):
 * images never leave a paired paragraph behind, so that cleanup step would
 * be dead weight there. When the removed range spans the *entire*
 * document (a lone table with no other content - `doc`'s content is flat
 * `block+`, see `schema.ts`, so `pos === 0 && end === doc.content.size`
 * exactly captures that), replaces it with a fresh empty paragraph in one
 * step via `replaceWith` instead of deleting first and inserting after:
 * `tr.delete` alone would pass through a zero-block document, which
 * `block+` forbids - `Transform`'s own fit-checking throws on that
 * intermediate state before a follow-up insert ever gets a chance to run. */
export function removeTable(pos: number, nodeSize: number): Command {
  return (state, dispatch) => {
    if (dispatch) {
      let end = pos + nodeSize;
      while (true) {
        const after = state.doc.nodeAt(end);
        if (!after || after.type !== schema.nodes.paragraph || after.content.size > 0) break;
        end += after.nodeSize;
      }
      const tr =
        pos === 0 && end === state.doc.content.size
          ? state.tr.replaceWith(pos, end, schema.nodes.paragraph!.createAndFill()!)
          : state.tr.delete(pos, end);
      dispatch(tr);
    }
    return true;
  };
}

/** Drives `table-menu.tsx`'s visibility/anchor - the table containing the
 * selection's top-level position, if any. Unlike `getSelectedImage` in
 * `commands.ts`, a table is never itself `NodeSelection`ed in normal use (the
 * cursor/`CellSelection` always sits *inside* one of its cells), so this
 * walks `$from`'s ancestors instead of checking the selection's own type. */
export function getSelectedTable(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.spec.tableRole === "table") {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/** Whether `table`'s own first row is a full header row - drives
 * `table-menu.tsx`'s "Toggle header row" pressed state. Takes the table node
 * directly (callers already have it from `getSelectedTable`) rather than
 * re-deriving it from `state`. */
export function isHeaderRowActive(table: PMNode): boolean {
  const firstRow = table.firstChild;
  if (!firstRow || firstRow.childCount === 0) return false;
  let allHeader = true;
  firstRow.forEach((cell) => {
    if (cell.type !== schema.nodes.table_header) allHeader = false;
  });
  return allHeader;
}

/** Whether the current selection can merge (a multi-cell `CellSelection`
 * whose outline is itself a rectangle) - `mergeCells` itself already
 * implements this check; calling it with no `dispatch` just tests
 * applicability, the standard prosemirror-state idiom for "is this command
 * enabled". Drives `table-menu.tsx`'s contextual merge/split button. */
export function canMergeCells(state: EditorState): boolean {
  return mergeCells(state);
}

/** Splits the cell the selection currently sits in/on back into its
 * constituent grid cells - unlike plain `splitCell` (which reuses the
 * merged cell's own type for every produced cell), only the cell(s) landing
 * in the table's own top row (grid row 0) become `table_header`; every
 * other produced cell becomes `table_cell`, per this feature's own spec.
 * Deliberately anchored to the table's row 0, not the merged cell's own top
 * row (`selectedRect(state).top`): a merge entirely within a body row (e.g.
 * two cells side by side in row 2) has no row of its own to call "top" other
 * than itself, and unmerging that shouldn't turn body cells into headers -
 * row 0 is the only row this schema ever treats as a header (see
 * `isHeaderRowActive`). */
export function unmergeCell(): Command {
  return splitCellWithType(({ row }) => (row === 0 ? schema.nodes.table_header! : schema.nodes.table_cell!));
}

/** Whether the current selection can unmerge (sits in/on a cell whose
 * `colspan`/`rowspan` is greater than 1) - same no-`dispatch`-just-tests
 * idiom as `canMergeCells` above. */
export function canUnmergeCell(state: EditorState): boolean {
  return unmergeCell()(state);
}

/** Splits `colWidths[index]`'s percentage in half, inserting the extra half
 * as a new entry right after it - shared by `insertColumnBefore`/`After`
 * below, called with whichever existing column's width the new column is
 * carved out of (the one immediately on the new column's other side). `null`
 * (never manually resized) needs no fix-up: an unset `colWidths` already
 * means "split evenly", which stays true with one more column. */
function splitColWidthAt(colWidths: number[] | null, index: number): number[] | null {
  if (!colWidths) return null;
  const width = colWidths[index] ?? 0;
  const left = Math.round(width / 2);
  const next = colWidths.slice();
  next.splice(index, 1, left, width - left);
  return next;
}

/** Inserts a column before the selection's own column, keeping `colWidths`
 * (if set) in sync in the same transaction/undo step - mirrors
 * `prosemirror-tables`' own `addColumnBefore`, plus the width fix-up. */
export function insertColumnBefore(): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const rect = selectedRect(state);
      const tr = addColumn(state.tr, rect, rect.left);
      const colWidths = splitColWidthAt(rect.table.attrs.colWidths as number[] | null, rect.left);
      if (colWidths) tr.setNodeAttribute(rect.tableStart - 1, "colWidths", colWidths);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Inserts a column after the selection's own column - see
 * `insertColumnBefore` above. */
export function insertColumnAfter(): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const rect = selectedRect(state);
      const tr = addColumn(state.tr, rect, rect.right);
      const colWidths = splitColWidthAt(rect.table.attrs.colWidths as number[] | null, rect.right - 1);
      if (colWidths) tr.setNodeAttribute(rect.tableStart - 1, "colWidths", colWidths);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Deletes every column the selection's outline spans, keeping `colWidths`
 * (if set) in sync - mirrors `prosemirror-tables`' own `deleteColumn`
 * (including its own right-to-left removal loop, needed since removing a
 * column shifts every table position after it), plus folding the removed
 * columns' combined percentage onto a surviving neighbor rather than just
 * dropping it (which would leave the remaining columns short of 100%). */
export function removeSelectedColumns(): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    if (rect.left === 0 && rect.right === rect.map.width) return false;
    if (dispatch) {
      const tableStart = rect.tableStart;
      const originalColWidths = rect.table.attrs.colWidths as number[] | null;
      const tr = state.tr;
      for (let i = rect.right - 1; ; i--) {
        removeColumn(tr, rect, i);
        if (i === rect.left) break;
        const table = tr.doc.nodeAt(tableStart - 1);
        if (!table) throw new RangeError("No table found");
        rect.table = table;
        rect.map = TableMap.get(table);
      }
      if (originalColWidths) {
        const removedSum = originalColWidths.slice(rect.left, rect.right).reduce((a, b) => a + b, 0);
        const next = [...originalColWidths.slice(0, rect.left), ...originalColWidths.slice(rect.right)];
        const neighbor = Math.min(rect.left, next.length - 1);
        if (neighbor >= 0) next[neighbor] = (next[neighbor] ?? 0) + removedSum;
        tr.setNodeAttribute(tableStart - 1, "colWidths", next.length > 0 ? next : null);
      }
      dispatch(tr);
    }
    return true;
  };
}
