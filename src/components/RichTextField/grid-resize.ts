import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { getFocusedGridItem, getSelectedGrid, GRID_INSERTED_META } from "./grid.js";
import { schema } from "./schema.js";

/**
 * `highlightLine` toggle (`grid-menu.tsx`'s own button) + the decorations it
 * drives - see `grid-item-view.ts`'s own doc comment for why the 2 resize
 * handles themselves live in that `NodeView` instead of here. This plugin
 * only needs to answer "should the highlight chrome be showing, and where":
 * a single grid's own doc position (at most one grid highlighted at a time)
 * plus 2 node decorations, both purely presentational
 * (`content-shadow-styles.ts`'s `.dry-tx-grid-highlight`/`.dry-tx-grid-focused`
 * classes do the actual visual work, including the resize handles' own
 * visibility - `grid-item-view.ts` renders them unconditionally and lets
 * these ancestor classes show/hide them via CSS).
 *
 * Anchored to the grid's own position (not "is the selection currently
 * inside a grid") specifically so toggling it on and then clicking
 * elsewhere in the document - to type in a different paragraph, say -
 * doesn't make the highlight disappear: it's a mode for that grid, not a
 * live reflection of where the cursor happens to be. Only the *focused*
 * item's own outline/handles stay selection-driven (see `buildDecorations`
 * below) - there's no single "focused item" to show once the selection has
 * actually left the grid.
 *
 * Defaults to on for a grid the user just inserted (`GRID_INSERTED_META`
 * below) - not for every grid a doc happens to load with, which would be
 * noisy for content nobody's actively editing right now; only the specific,
 * immediate "I just added a grid" moment defaults it on.
 */

export interface GridResizingState {
  /** Doc position of the grid currently showing highlight chrome, or
   * `null` - remapped through every doc-changing transaction
   * (`apply` below) the same way `table-row-resize.ts`'s `activeHandle` is,
   * and cleared if the node there ever stops being a `grid` (e.g. deleted
   * via `removeGrid`). */
  highlightGridPos: number | null;
}

export const gridResizingKey = new PluginKey<GridResizingState>("gridResizing");

export function isHighlightLineOn(state: EditorState, gridPos: number): boolean {
  return gridResizingKey.getState(state)?.highlightGridPos === gridPos;
}

/** Toggles `highlightLine` for the grid at `gridPos` via a plugin-only meta
 * transaction (not a real doc change) - `grid-menu.tsx` dispatches this
 * directly rather than lifting the flag to `RichTextField.tsx`-level Preact
 * state, the same "plugin owns its own transient UI state" idiom
 * `table-row-resize.ts`'s `dragging` already uses. Passing `false` (or
 * toggling off a grid that's already the highlighted one) clears it
 * entirely, rather than tracking per-grid on/off state - only one grid is
 * ever highlighted at a time. */
export function setHighlightLine(view: EditorView, gridPos: number, value: boolean) {
  view.dispatch(view.state.tr.setMeta(gridResizingKey, { setHighlightGridPos: value ? gridPos : null }));
}

function buildDecorations(state: EditorState, highlightGridPos: number | null): DecorationSet {
  if (highlightGridPos == null) return DecorationSet.empty;
  const gridNode = state.doc.nodeAt(highlightGridPos);
  if (!gridNode || gridNode.type !== schema.nodes.grid) return DecorationSet.empty;
  const decorations = [
    Decoration.node(highlightGridPos, highlightGridPos + gridNode.nodeSize, { class: "dry-tx-grid-highlight" }),
  ];
  const selectedGrid = getSelectedGrid(state);
  const focused = selectedGrid?.pos === highlightGridPos ? getFocusedGridItem(state) : null;
  if (focused) {
    decorations.push(Decoration.node(focused.pos, focused.pos + focused.node.nodeSize, { class: "dry-tx-grid-focused" }));
  }
  return DecorationSet.create(state.doc, decorations);
}

export function gridResizing(): Plugin<GridResizingState> {
  return new Plugin<GridResizingState>({
    key: gridResizingKey,
    state: {
      init: () => ({ highlightGridPos: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(gridResizingKey);
        if (meta && "setHighlightGridPos" in meta) return { highlightGridPos: meta.setHighlightGridPos as number | null };
        // Defaults a freshly-inserted grid's own highlightLine to on - see
        // `insertGrid`'s own doc comment in grid.ts for why this travels as
        // plain transaction meta instead of a direct call between the 2
        // files.
        const insertedAt = tr.getMeta(GRID_INSERTED_META);
        if (typeof insertedAt === "number") return { highlightGridPos: insertedAt };
        if (prev.highlightGridPos != null && tr.docChanged) {
          const mapped = tr.mapping.map(prev.highlightGridPos, -1);
          const node = tr.doc.nodeAt(mapped);
          return { highlightGridPos: node?.type === schema.nodes.grid ? mapped : null };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return buildDecorations(state, gridResizingKey.getState(state)?.highlightGridPos ?? null);
      },
    },
  });
}
