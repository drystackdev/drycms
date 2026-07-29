import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

/**
 * Row-height resizing for tables - ported from drystack's own
 * (`~/drystack/.../editor/table-row-resize.ts`), already vanilla
 * `prosemirror-state`/`-view` (its only non-portable bit was `css()` from
 * `@keystar/ui/style` for the resize-cursor class, swapped below for a plain
 * `.dry-tx-table-resize-cursor` class in `richtext-content.css`). Unlike column-width
 * resizing (the `columnResizing()` plugin, built into `prosemirror-tables`),
 * there's no upstream equivalent for rows, so this stays hand-rolled.
 */

// how close (in px) the pointer must be to a row boundary to activate its
// resize handle
const HANDLE_HITBOX = 6;
// rows can't be dragged shorter than this, in px - roughly one line of text
// plus the cell's own padding
const MIN_ROW_HEIGHT_PX = 24;

type Dragging = {
  startY: number;
  startHeightPx: number;
  minPx: number;
  // doc position of the row being resized (always the row *above* the
  // dragged boundary - resizing only ever changes one row's own height,
  // unlike column resizing, which trades width between two neighbors to keep
  // the table's total width constant - a table has no such total-height
  // constraint, so there's nothing to trade with).
  rowPos: number;
  // updated on every pointermove - `decorations()` reads this to render the
  // live row-height preview (see `buildDragDecorations`)
  currentClientY: number;
};

type PluginState = {
  // doc position of the row whose bottom-edge handle is active/dragged, or
  // -1 when no boundary is active
  activeHandle: number;
  dragging: Dragging | null;
};

export const tableRowResizingKey = new PluginKey<PluginState>("tableRowResizing");

function domRowAround(target: EventTarget | null): HTMLElement | null {
  let node = target as HTMLElement | null;
  while (node && node.nodeName !== "TR") {
    if (node.classList?.contains("ProseMirror")) return null;
    node = node.parentElement;
  }
  return node;
}

// resolves the doc position of the row immediately above the boundary
// nearest `event`'s y-position on the given side of the hovered row - or -1
// if there's no such row (e.g. dragging the top edge of a table's first row)
function edgeRowPos(view: EditorView, event: PointerEvent, side: "top" | "bottom"): number {
  const offset = side === "bottom" ? -HANDLE_HITBOX : HANDLE_HITBOX;
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY + offset });
  if (!found) return -1;
  const $pos = view.state.doc.resolve(found.pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.spec.tableRole !== "row") continue;
    const rowStart = $pos.before(depth);
    if (side === "bottom") return rowStart;
    // side === 'top': the boundary belongs to the *previous* row, if any
    const table = $pos.node(depth - 1);
    const rowIndex = $pos.index(depth - 1);
    if (rowIndex === 0) return -1;
    return rowStart - table.child(rowIndex - 1).nodeSize;
  }
  return -1;
}

function draggedHeightPx(dragging: Dragging, clientY: number): number {
  const dy = clientY - dragging.startY;
  return Math.max(Math.round(dragging.startHeightPx + dy), dragging.minPx);
}

// Live preview during a drag: renders a `style="height:…px"` override on the
// dragged row via a decoration - the ProseMirror-sanctioned way to apply a
// transient visual change without tripping the DOM-mutation observer.
function buildDragDecorations(state: EditorState, dragging: Dragging): Decoration[] {
  const node = state.doc.nodeAt(dragging.rowPos);
  if (!node) return [];
  const heightPx = draggedHeightPx(dragging, dragging.currentClientY);
  return [Decoration.node(dragging.rowPos, dragging.rowPos + node.nodeSize, { style: `height:${heightPx}px` })];
}

// Applies a plugin-only meta transaction directly via `view.updateState`
// instead of `view.dispatch`, so the drag preview (which fires on every
// animation frame) never reaches `useRichTextEditor.ts`'s `dispatchTransaction`
// (which forwards every dispatched transaction to the field's `onChange`).
function updateViewMeta(view: EditorView, meta: unknown) {
  const tr = view.state.tr.setMeta(tableRowResizingKey, meta);
  view.updateState(view.state.apply(tr));
}

function commitResize(view: EditorView, dragging: Dragging, heightPx: number) {
  let tr = view.state.tr.setNodeAttribute(dragging.rowPos, "heightPx", heightPx);
  tr = tr.setMeta(tableRowResizingKey, { setHandle: -1 });
  view.dispatch(tr);
}

function startDrag(view: EditorView, activeHandle: number, event: PointerEvent) {
  const rowDom = view.nodeDOM(activeHandle) as HTMLElement | null;
  if (!rowDom) return;

  const startHeightPx = rowDom.getBoundingClientRect().height;

  const dragging: Dragging = {
    startY: event.clientY,
    startHeightPx,
    minPx: MIN_ROW_HEIGHT_PX,
    rowPos: activeHandle,
    currentClientY: event.clientY,
  };
  updateViewMeta(view, { setDragging: dragging });

  const win = view.dom.ownerDocument.defaultView ?? window;
  let lastClientY = event.clientY;
  let rafId: number | null = null;

  const move = (moveEvent: PointerEvent) => {
    lastClientY = moveEvent.clientY;
    if (rafId != null) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      updateViewMeta(view, { updateDragY: lastClientY });
    });
  };
  const finish = () => {
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", finish);
    if (rafId != null) {
      win.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!tableRowResizingKey.getState(view.state)?.dragging) return;
    commitResize(view, dragging, draggedHeightPx(dragging, lastClientY));
  };
  win.addEventListener("pointermove", move);
  win.addEventListener("pointerup", finish);
}

/** Row-height resizing for tables: dragging a handle at a row's bottom edge
 * changes that row's own height and commits the result as a `heightPx` attr
 * on the row, rendered as inline `style="height:…px"` (see
 * `rowHeightStyleString` in `schema.ts`). */
export function tableRowResizing(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: tableRowResizingKey,
    state: {
      init: () => ({ activeHandle: -1, dragging: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(tableRowResizingKey);
        if (meta && "setHandle" in meta) return { activeHandle: meta.setHandle, dragging: null };
        if (meta && "setDragging" in meta) return { ...prev, dragging: meta.setDragging };
        if (meta && "updateDragY" in meta && prev.dragging) {
          return { ...prev, dragging: { ...prev.dragging, currentClientY: meta.updateDragY } };
        }
        if (prev.activeHandle > -1 && tr.docChanged) {
          const mapped = tr.mapping.map(prev.activeHandle, -1);
          const node = tr.doc.nodeAt(mapped);
          return { ...prev, activeHandle: node?.type.spec.tableRole === "row" ? mapped : -1 };
        }
        return prev;
      },
    },
    props: {
      attributes(state): Record<string, string> {
        const pluginState = tableRowResizingKey.getState(state);
        return pluginState && pluginState.activeHandle > -1 ? { class: "dry-tx-table-resize-cursor" } : {};
      },
      decorations(state) {
        const pluginState = tableRowResizingKey.getState(state);
        if (!pluginState?.dragging) return null;
        return DecorationSet.create(state.doc, buildDragDecorations(state, pluginState.dragging));
      },
      handleDOMEvents: {
        pointermove(view, event) {
          if (!view.editable) return false;
          const pluginState = tableRowResizingKey.getState(view.state);
          if (!pluginState || pluginState.dragging) return false;
          const target = domRowAround(event.target);
          let handle = -1;
          if (target) {
            const rect = target.getBoundingClientRect();
            if (event.clientY - rect.top <= HANDLE_HITBOX) {
              handle = edgeRowPos(view, event, "top");
            } else if (rect.bottom - event.clientY <= HANDLE_HITBOX) {
              handle = edgeRowPos(view, event, "bottom");
            }
          }
          if (handle !== pluginState.activeHandle) updateViewMeta(view, { setHandle: handle });
          return false;
        },
        pointerleave(view) {
          const pluginState = tableRowResizingKey.getState(view.state);
          if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging) {
            updateViewMeta(view, { setHandle: -1 });
          }
          return false;
        },
        pointerdown(view, event) {
          if (!view.editable) return false;
          const pluginState = tableRowResizingKey.getState(view.state);
          if (!pluginState || pluginState.activeHandle === -1 || pluginState.dragging) return false;
          startDrag(view, pluginState.activeHandle, event);
          event.preventDefault();
          return true;
        },
      },
    },
  });
}
