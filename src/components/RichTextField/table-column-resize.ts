import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { TableMap, cellAround } from "prosemirror-tables";

/**
 * Column-width resizing for tables - percent-based, integer-rounded,
 * table-level `colWidths` (see `schema.ts`'s `table` node), rendered via a
 * `<colgroup>`. Structurally mirrors `table-row-resize.ts` (pointer hitbox
 * near a boundary, drag state in a plugin, commit on pointerup) but doesn't
 * reuse `prosemirror-tables`' own `columnResizing()` plugin: that plugin's
 * per-cell, pixel-based `colwidth` model (plus its colored
 * `.column-resize-handle` bar) doesn't fit this field's contract - see
 * `schema.ts`'s own doc comment on `tableNodeSpecs`.
 *
 * Boundary-hit-testing (`domCellAround`/`edgeCellPos` below) mirrors
 * `columnResizing()`'s own `domCellAround`/`edgeCell` (see
 * `prosemirror-tables/src/columnresizing.ts`) - same proven approach to
 * "which grid column is this pointer position resizing", just without its
 * `handleWidth` naming. Unlike row-resize's live preview (a `Decoration` on
 * the row node, since a row's height is itself a documented position),
 * `<col>` elements aren't part of the document (they're synthesized by
 * `table`'s own `toDOM` from `colWidths`) - so the live drag preview instead
 * mutates the rendered `<col>` elements' inline widths directly via DOM
 * (rAF-throttled, same "don't dispatch on every frame" reasoning as
 * row-resize), and only the final width is committed as a real transaction
 * on pointerup.
 */

// how close (in px) the pointer must be to a column boundary to activate its
// resize handle
const HANDLE_HITBOX = 6;
// neither column in a dragged pair can be squeezed below this percent -
// keeps a resize from making one column's `<col>` unusably (or invisibly)
// narrow
const MIN_COL_PERCENT = 5;

type Dragging = {
  startX: number;
  startLeftPercent: number;
  startRightPercent: number;
  // grid column index of the LEFT side of the dragged boundary - the right
  // side is always `leftCol + 1`. Dragging the table's very last boundary is
  // never offered (see `rightNeighborOf` below): unlike columnResizing()'s
  // own px model (where growing the last column just grows the whole
  // table), this field's widths are a fixed-sum percentage, so the last
  // column has no right-hand neighbor to trade percent with.
  leftCol: number;
  // doc position of the `table` node itself (not `tableStart`) - what
  // `setNodeAttribute` below and `view.nodeDOM` both expect.
  tablePos: number;
  // snapshot of the table's colWidths at drag start (post-lazy-seed if it
  // was previously unset) - `commitResize` reads/writes into a copy of this
  // rather than the live `view.state`, matching row-resize's own `Dragging`
  // shape.
  colWidths: number[];
};

type PluginState = {
  // doc pos of the cell whose right edge is the active boundary, or -1
  activeHandle: number;
  dragging: Dragging | null;
};

export const tableColumnResizingKey = new PluginKey<PluginState>("tableColumnResizing");

function domCellAround(target: EventTarget | null): HTMLElement | null {
  let node = target as HTMLElement | null;
  while (node && node.nodeName !== "TD" && node.nodeName !== "TH") {
    if (node.classList?.contains("ProseMirror")) return null;
    node = node.parentElement;
  }
  return node;
}

// Resolves to the doc pos of the cell bordering the boundary nearest
// `event`'s x-position on the given side of the hovered cell - both sides
// converge on the same canonical position (the cell to the boundary's LEFT),
// matching `prosemirror-tables`' own `edgeCell`.
function edgeCellPos(view: EditorView, event: PointerEvent, side: "left" | "right"): number {
  const offset = side === "right" ? -HANDLE_HITBOX : HANDLE_HITBOX;
  const found = view.posAtCoords({ left: event.clientX + offset, top: event.clientY });
  if (!found) return -1;
  const $cell = cellAround(view.state.doc.resolve(found.pos));
  if (!$cell) return -1;
  if (side === "right") return $cell.pos;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const index = map.map.indexOf($cell.pos - start);
  return index % map.width === 0 ? -1 : start + map.map[index - 1]!;
}

/** The grid column (and its table) a "left-hand cell" doc pos (as resolved
 * by `edgeCellPos` above) belongs to - `null` when that cell's right edge is
 * the table's own outer edge (no right-hand neighbor to trade percent with,
 * see `Dragging.leftCol`'s own doc comment). */
function rightNeighborOf(view: EditorView, cellPos: number): { tablePos: number; leftCol: number; colCount: number } | null {
  const $cell = view.state.doc.resolve(cellPos);
  const cell = $cell.nodeAfter;
  if (!cell) return null;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const leftCol = map.colCount(cellPos - start) + (cell.attrs.colspan as number) - 1;
  if (leftCol >= map.width - 1) return null;
  return { tablePos: start - 1, leftCol, colCount: map.width };
}

/** The rendered `<table>` for the table node at `tablePos` - schema.ts's own
 * `toDOM` wraps it in a `.tableWrapper` div, so `view.nodeDOM` alone (which
 * returns that wrapper) isn't the element `<colgroup>`/`<col>` live under. */
function tableDOMAt(view: EditorView, tablePos: number): HTMLTableElement | null {
  const wrapper = view.nodeDOM(tablePos) as HTMLElement | null;
  return wrapper?.querySelector(":scope > table") ?? null;
}

/** Even integer percentages summing to exactly 100 - the last column
 * absorbs the rounding remainder, matching `renderedColWidths`'s own
 * convention below. */
function evenColWidths(count: number): number[] {
  const base = Math.floor(100 / count);
  const widths = Array.from({ length: count }, () => base);
  widths[count - 1] = 100 - base * (count - 1);
  return widths;
}

/** Reads back the currently-rendered percent widths - used to lazily seed
 * `colWidths` the first time a table (that's never been manually resized)
 * starts a drag, from whatever the browser is currently rendering the
 * (evenly-split, `table-layout: fixed`) columns at, so the dragged pair's
 * "before" state matches what's on screen rather than jumping. */
function renderedColWidths(tableDOM: HTMLTableElement, count: number): number[] {
  const totalWidth = tableDOM.getBoundingClientRect().width || 1;
  const row = tableDOM.querySelector("tr");
  const cellWidths: number[] = [];
  row?.querySelectorAll(":scope > td, :scope > th").forEach((cell) => {
    const rect = (cell as HTMLElement).getBoundingClientRect();
    const span = Number(cell.getAttribute("colspan") ?? 1) || 1;
    for (let i = 0; i < span; i++) cellWidths.push(rect.width / span);
  });
  if (cellWidths.length !== count) return evenColWidths(count);
  const rounded = cellWidths.map((width) => Math.round((width / totalWidth) * 100));
  const diff = 100 - rounded.reduce((a, b) => a + b, 0);
  rounded[rounded.length - 1] = (rounded[rounded.length - 1] ?? 0) + diff;
  return rounded;
}

function updateViewMeta(view: EditorView, meta: unknown) {
  const tr = view.state.tr.setMeta(tableColumnResizingKey, meta);
  view.updateState(view.state.apply(tr));
}

/** Splits `dragging`'s pair's combined percentage between the two columns at
 * `deltaPercent` (the drag's current x-offset, converted to percent of the
 * table's own width) - shared by the live-preview path and the final commit,
 * both integer-rounded and clamped so neither column goes below
 * `MIN_COL_PERCENT`. */
function draggedPair(dragging: Dragging, deltaPercent: number): { left: number; right: number } {
  const pairTotal = dragging.startLeftPercent + dragging.startRightPercent;
  const maxLeft = pairTotal - MIN_COL_PERCENT;
  const left = Math.round(Math.max(MIN_COL_PERCENT, Math.min(maxLeft, dragging.startLeftPercent + deltaPercent)));
  return { left, right: pairTotal - left };
}

function deltaPercentFor(view: EditorView, dragging: Dragging, clientX: number): number {
  const totalWidth = tableDOMAt(view, dragging.tablePos)?.getBoundingClientRect().width || 1;
  return ((clientX - dragging.startX) / totalWidth) * 100;
}

function applyLiveWidths(view: EditorView, dragging: Dragging, clientX: number) {
  const tableDOM = tableDOMAt(view, dragging.tablePos);
  const cols = tableDOM?.querySelectorAll(":scope > colgroup > col");
  if (!cols || cols.length !== dragging.colWidths.length) return;
  const { left, right } = draggedPair(dragging, deltaPercentFor(view, dragging, clientX));
  (cols[dragging.leftCol] as HTMLElement).style.width = `${left}%`;
  (cols[dragging.leftCol + 1] as HTMLElement).style.width = `${right}%`;
}

function commitResize(view: EditorView, dragging: Dragging, clientX: number) {
  const { left, right } = draggedPair(dragging, deltaPercentFor(view, dragging, clientX));
  const next = dragging.colWidths.slice();
  next[dragging.leftCol] = left;
  next[dragging.leftCol + 1] = right;
  let tr = view.state.tr.setNodeAttribute(dragging.tablePos, "colWidths", next);
  tr = tr.setMeta(tableColumnResizingKey, { setHandle: -1 });
  view.dispatch(tr);
}

function startDrag(view: EditorView, activeHandle: number, event: PointerEvent) {
  const target = rightNeighborOf(view, activeHandle);
  if (!target) return;

  const existing = (view.state.doc.nodeAt(target.tablePos)?.attrs.colWidths as number[] | null) ?? null;
  if (!existing || existing.length !== target.colCount) {
    const seedDOM = tableDOMAt(view, target.tablePos);
    if (!seedDOM) return;
    const seeded = renderedColWidths(seedDOM, target.colCount);
    view.dispatch(view.state.tr.setNodeAttribute(target.tablePos, "colWidths", seeded));
  }
  const colWidths = (view.state.doc.nodeAt(target.tablePos)?.attrs.colWidths as number[] | null) ?? evenColWidths(target.colCount);

  const dragging: Dragging = {
    startX: event.clientX,
    startLeftPercent: colWidths[target.leftCol] ?? 0,
    startRightPercent: colWidths[target.leftCol + 1] ?? 0,
    leftCol: target.leftCol,
    tablePos: target.tablePos,
    colWidths,
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
      applyLiveWidths(view, dragging, lastClientX);
    });
  };
  const finish = () => {
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", finish);
    if (rafId != null) {
      win.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!tableColumnResizingKey.getState(view.state)?.dragging) return;
    commitResize(view, dragging, lastClientX);
  };
  win.addEventListener("pointermove", move);
  win.addEventListener("pointerup", finish);
}

/** Column-width resizing for tables: dragging a handle at a column's right
 * edge splits that boundary's pair of columns' combined percentage between
 * them, committed as an integer-percent `colWidths` array on the table node
 * (rendered as a `<colgroup>` - see `schema.ts`). */
export function tableColumnResizing(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: tableColumnResizingKey,
    state: {
      init: () => ({ activeHandle: -1, dragging: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(tableColumnResizingKey);
        if (meta && "setHandle" in meta) return { activeHandle: meta.setHandle, dragging: null };
        if (meta && "setDragging" in meta) return { ...prev, dragging: meta.setDragging };
        if (prev.activeHandle > -1 && tr.docChanged) {
          return { ...prev, activeHandle: tr.mapping.map(prev.activeHandle, -1) };
        }
        return prev;
      },
    },
    props: {
      attributes(state): Record<string, string> {
        const pluginState = tableColumnResizingKey.getState(state);
        return pluginState && pluginState.activeHandle > -1 ? { class: "dry-tx-table-col-resize-cursor" } : {};
      },
      handleDOMEvents: {
        pointermove(view, event) {
          if (!view.editable) return false;
          const pluginState = tableColumnResizingKey.getState(view.state);
          if (!pluginState || pluginState.dragging) return false;
          const target = domCellAround(event.target);
          let handle = -1;
          if (target) {
            const rect = target.getBoundingClientRect();
            if (event.clientX - rect.left <= HANDLE_HITBOX) handle = edgeCellPos(view, event, "left");
            else if (rect.right - event.clientX <= HANDLE_HITBOX) handle = edgeCellPos(view, event, "right");
            if (handle > -1 && !rightNeighborOf(view, handle)) handle = -1;
          }
          if (handle !== pluginState.activeHandle) updateViewMeta(view, { setHandle: handle });
          return false;
        },
        pointerleave(view) {
          const pluginState = tableColumnResizingKey.getState(view.state);
          if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging) {
            updateViewMeta(view, { setHandle: -1 });
          }
          return false;
        },
        pointerdown(view, event) {
          if (!view.editable) return false;
          const pluginState = tableColumnResizingKey.getState(view.state);
          if (!pluginState || pluginState.activeHandle === -1 || pluginState.dragging) return false;
          startDrag(view, pluginState.activeHandle, event);
          event.preventDefault();
          return true;
        },
        // A real mouse fires a separate native `mousedown` right alongside
        // `pointerdown` above, and `prosemirror-tables`' own `tableEditing()`
        // plugin claims it (`handleMouseDown$1`) to support click-dragging a
        // cell selection - its handler runs (and, whenever the mousedown
        // lands inside any table cell, unconditionally attaches its own
        // `mousemove` tracker) regardless of what it eventually returns.
        // Dragging a column boundary crosses into the neighboring cell,
        // which that tracker reads as "selecting into a new cell" and
        // dispatches a real `CellSelection` transaction for on every such
        // crossing - each one is a genuine transaction, so it redraws the
        // table from its still-unchanged `colWidths` attr regardless of
        // `table-node-view.ts`'s `ignoreMutation` (that only suppresses the
        // reconciliation *our own* DOM-only writes would otherwise trigger,
        // not a redraw prompted by an unrelated real dispatch), wiping
        // `applyLiveWidths`'s preview almost as soon as it lands. This
        // plugin is listed *before* `tableEditing()` in `useRichTextEditor.ts`
        // specifically so this handler gets first crack at every `mousedown`;
        // claiming it here too (whenever a handle's active/being dragged) and
        // returning `true` short-circuits ProseMirror's plugin loop before
        // `tableEditing()`'s handler - and the competing tracker it would've
        // installed - ever runs.
        mousedown(view, event) {
          const pluginState = tableColumnResizingKey.getState(view.state);
          if (!pluginState || (pluginState.activeHandle === -1 && !pluginState.dragging)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
}
