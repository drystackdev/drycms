import type { ResolvedPos } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { colSpanStyleString, GRID_COLUMNS, schema } from "./schema.js";

/**
 * Column-span resizing for the grid feature - the direct horizontal
 * counterpart of `table-row-resize.ts`'s vertical row-height resizing
 * (same overall architecture: hover-activated handle, window-level drag,
 * `Decoration`-based live preview so nothing reaches `useRichTextEditor.ts`'s
 * `dispatchTransaction`/`onChange` until the drag commits). Unlike a table
 * row's height (which only ever affects that one row), a grid item's column
 * span is independent per block - CSS Grid's own auto-placement repacks
 * whatever doesn't fit on the current row onto the next one, so there's no
 * "trade width with a neighbor" bookkeeping needed the way table column
 * resizing has.
 *
 * Grid mode itself (whether the outline/handles are active at all) lives in
 * this plugin's own state - `useRichTextEditor.ts` syncs it here via a meta
 * transaction whenever the toolbar's grid-mode toggle changes, since that
 * toggle's boolean is otherwise just Preact state with no way to reach this
 * plugin on its own.
 */

// how close (in px) the pointer must be to a grid item's right edge to
// activate its resize handle - wider than `table-row-resize.ts`'s own 6px
// (a per-user-feedback bump: the handle was too thin to reliably grab).
const HANDLE_HITBOX = 10;

type Dragging = {
  startX: number;
  // fixed vertical anchor for the floating "{n}/GRID_COLUMNS" label - this is
  // a horizontal-only drag, so the label doesn't need to track Y at all
  startY: number;
  startColSpan: number;
  // pixel width of one of the section's `GRID_COLUMNS` columns, measured
  // once at drag start from the section's own rendered width
  colPx: number;
  // doc position of the grid-item block being resized (always a direct
  // child of `section` - see `gridItemPosFromDOM`)
  pos: number;
  // updated on every pointermove - `decorations()` reads this to render the
  // live column-span preview and the floating label
  currentClientX: number;
};

type PluginState = {
  gridMode: boolean;
  // doc position of the grid item whose right-edge handle is active/dragged,
  // or -1 when none is
  activeHandle: number;
  dragging: Dragging | null;
};

export const gridColumnResizingKey = new PluginKey<PluginState>("gridColumnResizing");

function domGridItemAround(target: EventTarget | null): HTMLElement | null {
  let node = target as HTMLElement | null;
  while (node) {
    if (node.parentElement?.tagName === "SECTION") return node;
    if (node.classList?.contains("ProseMirror")) return null;
    node = node.parentElement;
  }
  return null;
}

/** The section-child (paragraph/heading/blockquote/list/table) containing a
 * resolved position - shared by `gridItemPosFromDOM` (a DOM element under the
 * pointer) and `focusedGridItemPos` (the current selection) below. */
function gridItemPosAt($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth - 1).type === schema.nodes.section) return $pos.before(depth);
  }
  return null;
}

/** Resolves a grid-item DOM element (as found by `domGridItemAround`) back
 * to its doc position - always the start of whichever `section` child
 * (paragraph/heading/blockquote/list/table) contains it, even when the
 * element itself sits several DOM levels below `section` (e.g. a table's
 * `.tableWrapper` div). */
function gridItemPosFromDOM(view: EditorView, dom: HTMLElement): number | null {
  try {
    return gridItemPosAt(view.state.doc.resolve(view.posAtDOM(dom, 0)));
  } catch {
    // `posAtDOM` throws for a DOM node ProseMirror doesn't recognize - not
    // expected here since `domGridItemAround` only ever returns elements
    // inside the editor, but this keeps a stray throw from breaking the
    // pointermove handler.
    return null;
  }
}

/** The grid-item block the current selection sits in, if any - drives the
 * "only the focused block gets the strong outline" decoration below (a
 * hover anywhere else on `section` gets a lighter, purely-CSS `:hover`
 * outline instead - see `content-shadow-styles.ts`). */
function focusedGridItemPos(state: EditorState): number | null {
  return gridItemPosAt(state.selection.$from);
}

function draggedColSpan(dragging: Dragging, clientX: number): number {
  const deltaCols = Math.round((clientX - dragging.startX) / dragging.colPx);
  return Math.min(GRID_COLUMNS, Math.max(1, dragging.startColSpan + deltaCols));
}

function buildLabelEl(dragging: Dragging, colSpan: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "dry-tx-grid-label";
  el.textContent = `${colSpan}/${GRID_COLUMNS}`;
  el.style.position = "fixed";
  el.style.left = `${dragging.currentClientX + 10}px`;
  el.style.top = `${dragging.startY - 10}px`;
  return el;
}

// Live preview during a drag: a `grid-column: span N` override on the
// dragged block plus a floating "{n}/GRID_COLUMNS" label near the pointer -
// same "decorations only, no direct DOM mutation" reasoning as
// `table-row-resize.ts`'s own `buildDragDecorations`.
function buildDragDecorations(state: EditorState, dragging: Dragging): Decoration[] {
  const node = state.doc.nodeAt(dragging.pos);
  if (!node) return [];
  const colSpan = draggedColSpan(dragging, dragging.currentClientX);
  const style = colSpanStyleString(colSpan);
  return [
    Decoration.node(dragging.pos, dragging.pos + node.nodeSize, style ? { style } : {}),
    Decoration.widget(dragging.pos, () => buildLabelEl(dragging, colSpan)),
  ];
}

/** The persistent "this is the focused grid item" outline (see
 * `.dry-tx-grid-focused` in `content-shadow-styles.ts`) - shown whenever grid
 * mode is on, regardless of whether a resize drag is also in progress. */
function buildFocusDecoration(state: EditorState): Decoration[] {
  const pos = focusedGridItemPos(state);
  if (pos == null) return [];
  const node = state.doc.nodeAt(pos);
  if (!node) return [];
  return [Decoration.node(pos, pos + node.nodeSize, { class: "dry-tx-grid-focused" })];
}

// Applies a plugin-only meta transaction directly via `view.updateState`
// instead of `view.dispatch`, so the hover/drag preview (which fires on
// every pointermove/animation frame) never reaches
// `useRichTextEditor.ts`'s `dispatchTransaction` (which forwards every
// dispatched transaction to the field's `onChange`) - mirrors
// `table-row-resize.ts`'s own `updateViewMeta`.
function updateViewMeta(view: EditorView, meta: unknown) {
  const tr = view.state.tr.setMeta(gridColumnResizingKey, meta);
  view.updateState(view.state.apply(tr));
}

function commitResize(view: EditorView, dragging: Dragging, colSpan: number) {
  let tr = view.state.tr.setNodeAttribute(dragging.pos, "colSpan", colSpan);
  tr = tr.setMeta(gridColumnResizingKey, { setHandle: -1 });
  view.dispatch(tr);
}

function startDrag(view: EditorView, pos: number, event: PointerEvent) {
  const dom = view.nodeDOM(pos) as HTMLElement | null;
  const node = view.state.doc.nodeAt(pos);
  if (!dom?.parentElement || !node) return;

  const sectionWidthPx = dom.parentElement.getBoundingClientRect().width;
  const dragging: Dragging = {
    startX: event.clientX,
    startY: event.clientY,
    startColSpan: (node.attrs.colSpan as number | undefined) ?? GRID_COLUMNS,
    colPx: sectionWidthPx / GRID_COLUMNS,
    pos,
    currentClientX: event.clientX,
  };
  updateViewMeta(view, { setDragging: dragging });

  const win = view.dom.ownerDocument.defaultView ?? window;
  let lastClientX = event.clientX;
  let rafId: number | null = null;

  const move = (moveEvent: PointerEvent) => {
    lastClientX = moveEvent.clientX;
    if (rafId != null) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      updateViewMeta(view, { updateDragX: lastClientX });
    });
  };
  const finish = () => {
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", finish);
    if (rafId != null) {
      win.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!gridColumnResizingKey.getState(view.state)?.dragging) return;
    commitResize(view, dragging, draggedColSpan(dragging, lastClientX));
  };
  win.addEventListener("pointermove", move);
  win.addEventListener("pointerup", finish);
}

/** Column-span resizing for the grid feature: while grid mode is on,
 * dragging a handle at a top-level block's right edge changes how many of
 * the section's `GRID_COLUMNS` columns it spans, committed as a `colSpan`
 * attr rendered as inline `style="grid-column:span N"` (see
 * `colSpanStyleString` in `schema.ts`). Grid mode itself is plugin state,
 * toggled by `useRichTextEditor.ts` via a `{ setGridMode }` meta transaction
 * whenever the toolbar's grid-mode toggle changes. */
export function gridColumnResizing(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: gridColumnResizingKey,
    state: {
      init: () => ({ gridMode: false, activeHandle: -1, dragging: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(gridColumnResizingKey);
        if (meta && "setGridMode" in meta) return { gridMode: meta.setGridMode, activeHandle: -1, dragging: null };
        if (meta && "setHandle" in meta) return { ...prev, activeHandle: meta.setHandle, dragging: null };
        if (meta && "setDragging" in meta) return { ...prev, dragging: meta.setDragging };
        if (meta && "updateDragX" in meta && prev.dragging) {
          return { ...prev, dragging: { ...prev.dragging, currentClientX: meta.updateDragX } };
        }
        if (prev.activeHandle > -1 && tr.docChanged) {
          const mapped = tr.mapping.map(prev.activeHandle, -1);
          return { ...prev, activeHandle: tr.doc.nodeAt(mapped) ? mapped : -1 };
        }
        return prev;
      },
    },
    props: {
      attributes(state): Record<string, string> {
        const pluginState = gridColumnResizingKey.getState(state);
        if (!pluginState) return {};
        const classes: string[] = [];
        if (pluginState.gridMode) classes.push("dry-tx-grid-mode");
        if (pluginState.activeHandle > -1) classes.push("dry-tx-grid-resize-cursor");
        return classes.length ? { class: classes.join(" ") } : {};
      },
      decorations(state) {
        const pluginState = gridColumnResizingKey.getState(state);
        if (!pluginState?.gridMode) return null;
        // The focused-block outline stays up throughout a drag (not just
        // while idle) - dragging a handle doesn't move the selection away
        // from whatever block it was already in, so there's no reason for
        // its outline to disappear the moment a resize starts.
        const decorations = buildFocusDecoration(state);
        if (pluginState.dragging) decorations.push(...buildDragDecorations(state, pluginState.dragging));
        return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
      },
      handleDOMEvents: {
        pointermove(view, event) {
          if (!view.editable) return false;
          const pluginState = gridColumnResizingKey.getState(view.state);
          if (!pluginState || !pluginState.gridMode || pluginState.dragging) return false;
          const target = domGridItemAround(event.target);
          let handle = -1;
          if (target) {
            const rect = target.getBoundingClientRect();
            if (rect.right - event.clientX <= HANDLE_HITBOX && event.clientX <= rect.right + HANDLE_HITBOX) {
              handle = gridItemPosFromDOM(view, target) ?? -1;
            }
          }
          if (handle !== pluginState.activeHandle) updateViewMeta(view, { setHandle: handle });
          return false;
        },
        pointerleave(view) {
          const pluginState = gridColumnResizingKey.getState(view.state);
          if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging) {
            updateViewMeta(view, { setHandle: -1 });
          }
          return false;
        },
        pointerdown(view, event) {
          if (!view.editable) return false;
          const pluginState = gridColumnResizingKey.getState(view.state);
          if (!pluginState || !pluginState.gridMode || pluginState.activeHandle === -1 || pluginState.dragging) return false;
          startDrag(view, pluginState.activeHandle, event);
          event.preventDefault();
          return true;
        },
      },
    },
  });
}
