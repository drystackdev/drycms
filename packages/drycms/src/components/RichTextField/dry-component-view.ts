import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";
import type { ImageAlign } from "./schema.js";

const MIN_SIZE = 24;

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface HandleSpec {
  dir: HandleDir;
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
  locked: boolean;
  width: number;
  height: number;
}

/**
 * Mounts a `<dry-{name}>` custom element (already registered by
 * `useRichTextEditor.ts` via `defineDryComponent`) as this node's own DOM -
 * pattern ported from `image-view.ts`, incl. the same drag-to-resize
 * handles/wrapper-box structure for `inline` components (mục "đầy đủ chức
 * năng giống image" - width/height/align/lockAspectRatio, see schema.ts's
 * `buildDryNodeSpecs`). `block` components skip all of that - `dom` is just
 * the custom element itself, nothing to float/resize against.
 *
 * Unlike `image`, there's no `naturalWidth`/`naturalHeight` to seed a drag's
 * aspect ratio from (a generic component has no intrinsic size the way a
 * loaded image does) - `startDrag` always reads the box's current rendered
 * rect instead, same as `image-view.ts`'s own fallback for "not loaded yet".
 *
 * `ignoreMutation` is unconditionally `true` - the custom element's own
 * subtree is rendered and re-rendered entirely by Preact (the component
 * author's own code, not this file), so ProseMirror must never try to diff/
 * reconcile any of it as document content. Same reasoning covers this
 * view's own wrapper/box/handle DOM: none of that is real document content
 * either.
 *
 * The explicit `mousedown` -> `NodeSelection` is NOT the same "free from
 * ProseMirror's own default atom-click handling" `image`/`table` get -
 * confirmed empirically (Playwright, real `page.mouse.click`): PM's built-in
 * click-to-select walk only reliably resolves when the click lands on a DOM
 * node it itself tracks. `image`'s own children are just the bare `<img>`;
 * this node's whole subtree is Preact-rendered *after* construction and
 * entirely opaque to PM's `docView`, so a click landing on any of it (near
 * guaranteed) falls through to a plain text-position click instead.
 * Selecting explicitly on the outer element sidesteps that walk entirely.
 *
 * All of the above is for the ordinary atom (no-content) case. A
 * `children: true` component (`hasContent` below, always `block`, never
 * `isInline` - `register-component.ts`'s own validation) inverts every one
 * of those: `this.element` itself becomes `contentDOM`, so its *light-DOM*
 * children are real, ProseMirror-owned document content (a browser only
 * projects light-DOM children into a shadow tree's `<slot />` - Preact's
 * own render always targets the *shadow* root, `dry-component-runtime.ts`,
 * so the two never collide). ProseMirror needs its own default mousedown/
 * click handling back to place a cursor in there, so `stopEvent` and the
 * `mousedown` listener below both go inert for this case, and
 * `ignoreMutation` narrows to just the one `props` attribute mutation this
 * view itself makes (same targeted scope `grid-item-view.ts` uses for its
 * own live-resize `style` attribute) rather than ignoring everything.
 */
export class DryComponentNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  private node: PMNode;
  private readonly isInline: boolean;
  private readonly hasContent: boolean;
  private box: HTMLElement;
  private element: HTMLElement;
  private handleEls: HTMLElement[] = [];
  private drag: DragState | null = null;

  constructor(
    node: PMNode,
    tag: string,
    type: "inline" | "block",
    hasContent: boolean,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.node = node;
    this.isInline = type === "inline";
    this.hasContent = hasContent && !this.isInline;

    if (!this.isInline) {
      // Block: no wrapper/box/handles needed (nothing to float or resize
      // against - see this class's own doc comment) - `dom` is the custom
      // element itself, same shape as the original (pre-resize) version.
      this.element = document.createElement(tag);
      this.dom = this.element;
      this.box = this.element;
      if (this.hasContent) this.contentDOM = this.element;
    } else {
      this.dom = document.createElement("span");
      this.dom.className = "dry-component-wrapper";
      this.box = document.createElement("span");
      this.box.className = "dry-component-box";
      this.dom.appendChild(this.box);
      this.element = document.createElement(tag);
      // Explicit `block` - a custom element defaults to plain `inline` (no
      // UA style beyond that), and Preact renders block-level content into
      // it (this component's own root, e.g. a `<div>`) - an inline box
      // containing block content forces the browser into an anonymous-
      // block split around it, which throws off `box`'s own "last line
      // box" baseline computation (`.dry-component-wrapper`'s
      // `vertical-align: baseline` above ends up reading as roughly
      // "middle" instead). `block` here removes that ambiguity outright:
      // `box`'s only child is then unambiguously a block box with no line
      // boxes of its own, so its baseline falls back to its bottom margin
      // edge - the exact same rule a replaced element like `<img>` uses,
      // which is why `image` never needed this.
      this.element.style.display = "block";
      this.element.style.width = "100%";
      this.element.style.height = "100%";
      this.box.appendChild(this.element);

      for (const handle of HANDLES) {
        const el = document.createElement("span");
        el.className = "dry-component-handle";
        el.style.top = handle.top;
        el.style.left = handle.left;
        el.style.cursor = handle.cursor;
        el.addEventListener("pointerdown", (event) => this.startDrag(handle, event));
        this.handleEls.push(el);
      }
    }

    // Skipped for `hasContent` - it would hijack every click into content
    // (real, cursor-placeable document text) as a whole-node select instead
    // (see this class's own doc comment).
    if (!this.hasContent) {
      this.dom.addEventListener("mousedown", (event) => {
        const pos = this.getPos();
        if (pos === undefined) return;
        event.preventDefault();
        this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      });
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
    if (drag.locked) {
      if (drag.hx !== 0) h = w / drag.ratio;
      else w = h * drag.ratio;
    }
    drag.width = Math.round(w);
    drag.height = Math.round(h);
    this.box.style.width = `${drag.width}px`;
    this.box.style.height = `${drag.height}px`;
  };

  private onPointerUp = () => {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    // `setNodeAttribute` per attr, not `setNodeMarkup` - the latter replaces
    // this leaf/atom node outright, which drops the `NodeSelection` the
    // floating settings menu (`dry-component-menu.tsx`) depends on. Same
    // reasoning as `image-view.ts`'s own `onPointerUp`.
    this.view.dispatch(
      this.view.state.tr.setNodeAttribute(pos, "width", drag.width).setNodeAttribute(pos, "height", drag.height),
    );
  };

  private startDrag(handle: HandleSpec, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.box.getBoundingClientRect();
    const ratio = rect.height ? rect.width / rect.height : 1;
    this.drag = {
      hx: handle.hx,
      vy: handle.vy,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      ratio,
      locked: !!this.node.attrs.lockAspectRatio,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private render() {
    this.element.setAttribute("props", JSON.stringify(this.node.attrs.props));
    if (!this.isInline) return;

    const width = this.node.attrs.width as number | null;
    const height = this.node.attrs.height as number | null;
    this.box.style.width = width != null ? `${width}px` : "";
    this.box.style.height = height != null ? `${height}px` : "";
    this.renderAlign(this.node.attrs.align as ImageAlign | null);
  }

  /** Ported from `image-view.ts`'s own `renderAlign` - applied to `dom`
   * (the wrapper), same reasoning: floating just the box would take it out
   * of flow while leaving the wrapper in flow with nothing to size itself
   * by. */
  private renderAlign(align: ImageAlign | null) {
    this.dom.style.float = align === "left" || align === "right" ? align : "";
    this.dom.style.minWidth = align === "center" ? "100%" : "";
    this.dom.style.textAlign = align === "center" ? "center" : "";
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
    // Own class, not `.is-selected` - see this file's own doc comment.
    this.box.classList.add("dry-component-is-selected");
    for (const el of this.handleEls) this.box.appendChild(el);
  }

  deselectNode() {
    this.box.classList.remove("dry-component-is-selected");
    for (const el of this.handleEls) el.remove();
  }

  /** `hasContent` narrows to just this view's own `props`-attribute write
   * (`render()` below) - same targeted scope `grid-item-view.ts` uses for
   * its own live-resize `style` attribute - so ProseMirror still observes
   * real edits inside `contentDOM` normally. Otherwise unconditionally
   * `true` - see this class's own doc comment. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (this.hasContent) return mutation.type === "attributes" && mutation.target === this.element;
    return true;
  }

  /** Tells ProseMirror not to run its OWN default `mousedown` handling on
   * top of the listener above (see this class's own doc comment), and -
   * same as `image-view.ts` - keeps a handle drag from being treated as a
   * text-selection drag inside the editor. `hasContent` needs the opposite:
   * ProseMirror's own default `mousedown` handling is what places a cursor
   * inside real content, and this view no longer installs a competing
   * listener of its own to replace it with. */
  stopEvent(event: Event): boolean {
    if (event.type === "mousedown") return !this.hasContent;
    return event.type === "pointerdown" && this.handleEls.includes(event.target as HTMLElement);
  }
}
