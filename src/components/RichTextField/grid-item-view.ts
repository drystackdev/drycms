import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";
import { DEFAULT_GRID_COLUMNS, gridItemStyleString, schema } from "./schema.js";

/**
 * Drag-to-resize handles for a grid cell's own `colSpan`/`rowSpan` - same
 * "plain pointer-event NodeView, live DOM mutation during drag, commit on
 * pointerup" shape `image-view.ts` already uses for image resize, not
 * `table-row-resize.ts`/`table-column-resize.ts`'s plugin-plus-decoration
 * approach: those exist because a table boundary is *shared* by two
 * neighboring rows/columns (dragging one edge changes two nodes' attrs at
 * once, needing a plugin to coordinate). A grid item's `colSpan`/`rowSpan`
 * is entirely its own attr, affecting no sibling - exactly the "one node
 * resizes itself" shape the image already solves this way.
 *
 * The 2 handles' visibility is pure CSS (`content-shadow-styles.ts`'s
 * `.dry-tx-grid-highlight .dry-tx-grid-focused` descendant rule, driven by
 * `grid-resize.ts`'s decorations) - this view doesn't read that plugin's
 * state at all, just always renders both handles into the DOM.
 */

const MIN_SPAN = 1;

type Axis = "col" | "row";

interface DragState {
  axis: Axis;
  startClientX: number;
  startClientY: number;
  startColSpan: number;
  startRowSpan: number;
  // px-per-track, snapshotted at drag start from this item's own rendered
  // size divided by its current span - rows have no fixed track size
  // (native grid auto-sizes them), so this is a drag-only approximation of
  // "how many px is one more row", not a real layout constant.
  pxPerCol: number;
  pxPerRow: number;
  colSpan: number;
  rowSpan: number;
  // Snapshotted at drag start from the enclosing grid's own `columns` attr -
  // a grid's column count is per-instance now (`grid-menu.tsx`'s columns
  // selector), not the fixed constant this clamp used to check against.
  maxCol: number;
}

export class GridItemNodeView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLDivElement;
  private node: PMNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private colHandle: HTMLElement;
  private rowHandle: HTMLElement;
  private drag: DragState | null = null;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "dry-tx-grid-item";

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "dry-tx-grid-item-content";
    this.dom.appendChild(this.contentDOM);

    this.colHandle = document.createElement("span");
    this.colHandle.className = "dry-tx-grid-handle dry-tx-grid-handle-col";
    this.colHandle.addEventListener("pointerdown", (event) => this.startDrag("col", event));
    this.dom.appendChild(this.colHandle);

    this.rowHandle = document.createElement("span");
    this.rowHandle.className = "dry-tx-grid-handle dry-tx-grid-handle-row";
    this.rowHandle.addEventListener("pointerdown", (event) => this.startDrag("row", event));
    this.dom.appendChild(this.rowHandle);

    this.render();
  }

  private render() {
    this.dom.setAttribute("style", gridItemStyleString(this.node.attrs.colSpan as number, this.node.attrs.rowSpan as number));
  }

  /** The enclosing grid's own `columns` attr - resolving `getPos()` (the
   * position right before this item, i.e. inside the grid's own content)
   * lands `$pos.parent` on that grid node. Falls back to
   * `DEFAULT_GRID_COLUMNS` if the position can't be resolved (view not yet
   * mounted) rather than throwing. */
  private enclosingGridColumns(): number {
    const pos = this.getPos();
    if (pos == null) return DEFAULT_GRID_COLUMNS;
    const parent = this.view.state.doc.resolve(pos).parent;
    return parent.type === schema.nodes.grid ? (parent.attrs.columns as number) : DEFAULT_GRID_COLUMNS;
  }

  private startDrag(axis: Axis, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.dom.getBoundingClientRect();
    const colSpan = this.node.attrs.colSpan as number;
    const rowSpan = this.node.attrs.rowSpan as number;
    this.drag = {
      axis,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startColSpan: colSpan,
      startRowSpan: rowSpan,
      pxPerCol: rect.width / colSpan,
      pxPerRow: rect.height / rowSpan,
      colSpan,
      rowSpan,
      maxCol: this.enclosingGridColumns(),
    };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    if (drag.axis === "col") {
      const deltaCols = drag.pxPerCol > 0 ? Math.round((event.clientX - drag.startClientX) / drag.pxPerCol) : 0;
      drag.colSpan = Math.min(drag.maxCol, Math.max(MIN_SPAN, drag.startColSpan + deltaCols));
    } else {
      const deltaRows = drag.pxPerRow > 0 ? Math.round((event.clientY - drag.startClientY) / drag.pxPerRow) : 0;
      drag.rowSpan = Math.max(MIN_SPAN, drag.startRowSpan + deltaRows);
    }
    this.dom.setAttribute("style", gridItemStyleString(drag.colSpan, drag.rowSpan));
  };

  private onPointerUp = () => {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const pos = this.getPos();
    if (pos == null) return;
    if (drag.colSpan === drag.startColSpan && drag.rowSpan === drag.startRowSpan) {
      this.render();
      return;
    }
    let tr = this.view.state.tr;
    if (drag.colSpan !== drag.startColSpan) tr = tr.setNodeAttribute(pos, "colSpan", drag.colSpan);
    if (drag.rowSpan !== drag.startRowSpan) tr = tr.setNodeAttribute(pos, "rowSpan", drag.rowSpan);
    this.view.dispatch(tr);
  };

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.drag) this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.type === "pointerdown" && (event.target === this.colHandle || event.target === this.rowHandle);
  }

  /** This view owns `dom`'s own `style` attribute during a drag (live visual
   * feedback, committed as a real attr change only on pointerup, same as
   * `image-view.ts`) - ignore only mutations to `dom` itself, the same
   * targeted scope `table-node-view.ts` uses, so ProseMirror still observes
   * real edits inside `contentDOM` normally. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type === "attributes" && mutation.target === this.dom;
  }

  destroy() {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  }
}
