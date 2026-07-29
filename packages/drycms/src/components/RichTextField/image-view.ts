import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import type { ImageAlign } from "./schema.js";

/**
 * Drag-to-resize handles for the inline image node - ported from drystack's
 * `resize-handles.tsx`/`image-node-view.tsx`, but as a plain ProseMirror
 * `NodeView` (vanilla DOM + `pointer*` events) instead of a React component:
 * a `NodeView`'s `dom`/`update`/`selectNode`/etc. are already framework-
 * agnostic, so this needs no Preact at all. Unlike drystack, there's no
 * separate lock-aspect-ratio toggle - this field always preserves the
 * image's natural ratio while resizing, matching drystack's own default.
 */

const MIN_SIZE = 24;

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface HandleSpec {
  dir: HandleDir;
  /** Which side of the image this handle drags: +1 = east/south (drag
   * towards it grows), -1 = west/north, 0 = doesn't affect that axis. */
  hx: -1 | 0 | 1;
  vy: -1 | 0 | 1;
  cursor: string;
  top: string;
  left: string;
}

const HANDLES: HandleSpec[] = [
  { dir: "nw", hx: -1, vy: -1, cursor: "nwse-resize", top: "0%", left: "0%" },
  { dir: "n", hx: 0, vy: -1, cursor: "ns-resize", top: "0%", left: "50%" },
  { dir: "ne", hx: 1, vy: -1, cursor: "nesw-resize", top: "0%", left: "100%" },
  { dir: "e", hx: 1, vy: 0, cursor: "ew-resize", top: "50%", left: "100%" },
  { dir: "se", hx: 1, vy: 1, cursor: "nwse-resize", top: "100%", left: "100%" },
  { dir: "s", hx: 0, vy: 1, cursor: "ns-resize", top: "100%", left: "50%" },
  { dir: "sw", hx: -1, vy: 1, cursor: "nesw-resize", top: "100%", left: "0%" },
  { dir: "w", hx: -1, vy: 0, cursor: "ew-resize", top: "50%", left: "0%" },
];

interface DragState {
  hx: number;
  vy: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  ratio: number;
  width: number;
  height: number;
}

export class ImageNodeView implements NodeView {
  dom: HTMLSpanElement;
  private img: HTMLImageElement;
  private node: PMNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  private naturalRatio: number | null = null;
  private handleEls: HTMLElement[] = [];
  private drag: DragState | null = null;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("span");
    this.dom.className = "richtext-image-wrapper";

    this.img = document.createElement("img");
    this.img.className = "richtext-image";
    this.img.draggable = false;
    this.img.addEventListener("load", () => {
      if (this.img.naturalHeight) this.naturalRatio = this.img.naturalWidth / this.img.naturalHeight;
    });
    this.dom.appendChild(this.img);

    for (const handle of HANDLES) {
      const el = document.createElement("span");
      el.className = "richtext-image-handle";
      el.style.top = handle.top;
      el.style.left = handle.left;
      el.style.cursor = handle.cursor;
      el.addEventListener("pointerdown", (event) => this.startDrag(handle, event));
      this.handleEls.push(el);
    }

    this.render();
  }

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let w = Math.max(MIN_SIZE, drag.startWidth + drag.hx * dx);
    let h = Math.max(MIN_SIZE, drag.startHeight + drag.vy * dy);
    // corner/edge handles all preserve the aspect ratio: a side handle
    // (hx !== 0) drives width, a top/bottom handle drives height.
    if (drag.hx !== 0) h = w / drag.ratio;
    else w = h * drag.ratio;
    drag.width = Math.round(w);
    drag.height = Math.round(h);
    this.img.style.width = `${drag.width}px`;
    this.img.style.height = `${drag.height}px`;
    this.img.style.maxWidth = "none";
    this.img.style.maxHeight = "none";
  };

  private onPointerUp = () => {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width: drag.width, height: drag.height }),
    );
  };

  private startDrag(handle: HandleSpec, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.img.getBoundingClientRect();
    const ratio = this.naturalRatio ?? (rect.height ? rect.width / rect.height : 1);
    this.drag = {
      hx: handle.hx,
      vy: handle.vy,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      ratio,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private render() {
    this.img.src = this.node.attrs.src as string;
    this.img.alt = (this.node.attrs.alt as string) ?? "";
    const width = this.node.attrs.width as number | null;
    const height = this.node.attrs.height as number | null;
    this.img.style.width = width != null ? `${width}px` : "";
    this.img.style.height = height != null ? `${height}px` : "";
    this.img.style.maxWidth = width != null ? "none" : "";
    this.img.style.maxHeight = height != null ? "none" : "";
    this.img.style.objectFit = width != null || height != null ? "contain" : "";
    this.renderAlign(this.node.attrs.align as ImageAlign | null);
  }

  /**
   * Applied to `this.dom` (the node view's own root, tracked by ProseMirror)
   * rather than `this.img` - ported from drystack's `imageContainerAlignStyle`,
   * whose comment explains why: floating the inner `<img>` alone would take
   * it out of flow while leaving this outer wrapper in flow with nothing to
   * size itself by, collapsing it to a zero-size box at the image's text
   * position. `left`/`right` just float the wrapper (already `inline-block`
   * via forms.css's `.richtext-image-wrapper`, so floating changes nothing
   * else about its sizing); `center` needs an explicit `display: block` since
   * nothing else here makes it one, and `width: fit-content` so the wrapper
   * (a `<span>`) doesn't stretch to the paragraph's full width once it is.
   */
  private renderAlign(align: ImageAlign | null) {
    this.dom.style.float = align === "left" || align === "right" ? align : "";
    this.dom.style.display = align === "center" ? "block" : "";
    this.dom.style.width = align === "center" ? "fit-content" : "";
    // Longhand, not the `margin-inline` shorthand: unlike `margin-inline-start`/
    // `-end` below (which do take effect), assigning the shorthand's camelCase
    // form through `CSSStyleDeclaration` is a silent no-op in this app's target
    // browsers - confirmed via the RichTextField image-menu Playwright check.
    this.dom.style.marginInlineStart = align === "center" ? "auto" : align === "right" ? "1em" : "";
    this.dom.style.marginInlineEnd = align === "center" ? "auto" : align === "left" ? "1em" : "";
    this.dom.style.marginBlock = align === "left" || align === "right" ? "0.5em" : "";
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("is-selected");
    for (const el of this.handleEls) this.dom.appendChild(el);
  }

  deselectNode() {
    this.dom.classList.remove("is-selected");
    for (const el of this.handleEls) el.remove();
  }

  /** Keeps ProseMirror from treating a handle drag as a text-selection
   * drag inside the editor. */
  stopEvent(event: Event): boolean {
    return event.type === "pointerdown" && this.handleEls.includes(event.target as HTMLElement);
  }

  /** This view owns `img.style` during a drag (for live visual feedback,
   * committed as a real attr change only on pointerup) - tell ProseMirror
   * not to treat that as an out-of-band document change. */
  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  }
}
