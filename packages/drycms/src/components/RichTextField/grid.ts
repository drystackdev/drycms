import type { Attrs, Node as PMNode, NodeType } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { Selection } from "prosemirror-state";
import { canSplit } from "prosemirror-transform";
import { GRID_COLUMNS, schema } from "./schema.js";

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

const DEFAULT_ITEM_ATTRS = { colSpan: GRID_COLUMNS, rowSpan: 1 };

function buildGrid(): PMNode {
  const gridItem = schema.nodes.grid_item!.create(DEFAULT_ITEM_ATTRS, schema.nodes.paragraph!.createAndFill()!);
  return schema.nodes.grid!.create(null, gridItem);
}

/** Inserts a fresh grid (one default full-width item) at the selection -
 * mirrors `insertTable`'s own trailing-paragraph fix-up for the same reason:
 * without it, a grid inserted at the very end of the document leaves the
 * cursor nowhere to go afterward. */
export function insertGrid(): Command {
  return (state, dispatch) => {
    if (dispatch) {
      let tr = state.tr.replaceSelectionWith(buildGrid());
      if (Selection.atEnd(state.doc).from === state.selection.to) {
        tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph!.createAndFill()!);
      }
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
    if ($from.node($from.depth - 2)?.type !== schema.nodes.grid) return false;

    // `typesAfter` is ordered outermost-split-level first (index 0 = the
    // `grid_item` boundary, index 1 = the textblock boundary) - matches
    // `prosemirror-schema-list`'s own `splitListItem`, whose `types` array
    // puts `itemType` (its outer level) at index 0 and the inner textblock's
    // type at index 1.
    const typesAfter: ({ type: NodeType; attrs?: Attrs | null } | null)[] = [
      { type: schema.nodes.grid_item!, attrs: DEFAULT_ITEM_ATTRS },
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
