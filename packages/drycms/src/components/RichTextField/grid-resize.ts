import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { getFocusedGridItem, getSelectedGrid } from "./grid.js";

/**
 * `highlightLine` toggle (`grid-menu.tsx`'s own button) + the decorations it
 * drives - see `grid-item-view.ts`'s own doc comment for why the 2 resize
 * handles themselves live in that `NodeView` instead of here. This plugin
 * only needs to answer "should the highlight chrome be showing, and where":
 * a plain boolean toggle plus 2 node decorations, both purely presentational
 * (`content-shadow-styles.ts`'s `.dry-tx-grid-highlight`/`.dry-tx-grid-focused`
 * classes do the actual visual work, including the resize handles' own
 * visibility - `grid-item-view.ts` renders them unconditionally and lets
 * these ancestor classes show/hide them via CSS).
 */

export interface GridResizingState {
  highlightLine: boolean;
}

export const gridResizingKey = new PluginKey<GridResizingState>("gridResizing");

export function isHighlightLineOn(state: EditorState): boolean {
  return gridResizingKey.getState(state)?.highlightLine ?? false;
}

/** Toggles `highlightLine` via a plugin-only meta transaction (not a real
 * doc change) - `grid-menu.tsx` dispatches this directly rather than lifting
 * the flag to `RichTextField.tsx`-level Preact state, the same "plugin owns
 * its own transient UI state" idiom `table-row-resize.ts`'s `dragging`
 * already uses. */
export function setHighlightLine(view: EditorView, value: boolean) {
  view.dispatch(view.state.tr.setMeta(gridResizingKey, { setHighlightLine: value }));
}

function buildDecorations(state: EditorState, highlightLine: boolean): DecorationSet {
  if (!highlightLine) return DecorationSet.empty;
  const grid = getSelectedGrid(state);
  if (!grid) return DecorationSet.empty;
  const decorations = [Decoration.node(grid.pos, grid.pos + grid.node.nodeSize, { class: "dry-tx-grid-highlight" })];
  const focused = getFocusedGridItem(state);
  if (focused) {
    decorations.push(Decoration.node(focused.pos, focused.pos + focused.node.nodeSize, { class: "dry-tx-grid-focused" }));
  }
  return DecorationSet.create(state.doc, decorations);
}

export function gridResizing(): Plugin<GridResizingState> {
  return new Plugin<GridResizingState>({
    key: gridResizingKey,
    state: {
      init: () => ({ highlightLine: false }),
      apply(tr, prev) {
        const meta = tr.getMeta(gridResizingKey);
        if (meta && "setHighlightLine" in meta) return { highlightLine: meta.setHighlightLine as boolean };
        return prev;
      },
    },
    props: {
      decorations(state) {
        return buildDecorations(state, gridResizingKey.getState(state)?.highlightLine ?? false);
      },
    },
  });
}
