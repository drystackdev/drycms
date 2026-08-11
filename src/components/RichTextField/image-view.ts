import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import type { ImageAlign, ImageObjectFit } from "./schema.js";

/**
 * Drag-to-resize handles for the inline image node - ported from drystack's
 * `resize-handles.tsx`/`image-node-view.tsx`, but as a plain ProseMirror
 * `NodeView` (vanilla DOM + `pointer*` events) instead of a React component:
 * a `NodeView`'s `dom`/`update`/`selectNode`/etc. are already framework-
 * agnostic, so this needs no Preact at all. The `lockAspectRatio` attr
 * (toggled from `image-menu.tsx`'s standalone lock button, or its edit
 * dialog) picks which of drystack's two drag behaviors applies: locked
 * preserves the image's natural ratio exactly like drystack does, unlocked
 * resizes each dragged handle's own axis independently.
 *
 * DOM shape: `dom` (`.dry-tx-image-wrapper`, carries align/float - the
 * live-editor equivalent of `html.ts`'s exported `<figure>`) > `imageBox`
 * (`.dry-tx-image-box`, `position: relative` and the `.is-selected` outline -
 * what the resize handles' `top`/`left` percentages actually anchor to)
 * > `img`, plus the handles themselves while selected; and a
 * `figcaption` sibling of `imageBox`, appended only once `node.attrs.caption`
 * is actually set (and removed again if it's cleared back to empty) rather
 * than kept in the DOM permanently and just hidden - so an uncaptioned image
 * carries no `<figcaption>` at all, live or exported. The handles
 * anchor to `imageBox` rather than `dom` directly so a caption's own
 * height (a block box stacked below `imageBox` once one exists) can't
 * shift what "100%" means for a handle meant to sit at the image's own
 * bottom edge.
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
  /** Snapshot of `node.attrs.lockAspectRatio` at drag start - the toggle
   * button can't change mid-drag (it's on a floating panel outside the
   * image), so there's no need to re-read it on every pointermove. */
  locked: boolean;
  width: number;
  height: number;
}

export class ImageNodeView implements NodeView {
  dom: HTMLSpanElement;
  private imageBox: HTMLSpanElement;
  private img: HTMLImageElement;
  private captionEl: HTMLElement;
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
    this.dom.className = "dry-tx-image-wrapper";

    this.imageBox = document.createElement("span");
    this.imageBox.className = "dry-tx-image-box";
    this.dom.appendChild(this.imageBox);

    this.img = document.createElement("img");
    this.img.className = "dry-tx-image";
    this.img.draggable = false;
    this.img.addEventListener("load", () => {
      if (this.img.naturalHeight) this.naturalRatio = this.img.naturalWidth / this.img.naturalHeight;
    });
    this.imageBox.appendChild(this.img);

    this.captionEl = document.createElement("figcaption");
    this.captionEl.className = "dry-tx-image-caption";
    this.captionEl.contentEditable = "false";
    // Not appended here - `render()` attaches/detaches it based on whether
    // `node.attrs.caption` is actually set (see the class doc comment above).

    for (const handle of HANDLES) {
      const el = document.createElement("span");
      el.className = "dry-tx-image-handle";
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
    // Locked: preserve the aspect ratio - a side handle (hx !== 0) drives
    // width, a top/bottom handle drives height. Unlocked: each handle's own
    // axis (hx/vy above) already resized independently, nothing to sync.
    if (drag.locked) {
      if (drag.hx !== 0) h = w / drag.ratio;
      else w = h * drag.ratio;
    }
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
    // `setNodeAttribute` per attr, not `setNodeMarkup` - the latter replaces
    // this leaf/atom node outright, which drops the `NodeSelection` the
    // floating image menu (`image-menu.tsx`) depends on, closing it right as
    // the drag that most likely called for it (align/lock right after
    // resizing) ends. Same reasoning as `commands.ts`'s `setImageAttrs`.
    this.view.dispatch(
      this.view.state.tr.setNodeAttribute(pos, "width", drag.width).setNodeAttribute(pos, "height", drag.height),
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
      locked: !!this.node.attrs.lockAspectRatio,
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
    // Same condition as `imageSizeAndFitStyleString` in schema.ts, which
    // `html.ts`'s export shares (this node view has its own direct `.style`
    // write instead, but the two must stay identical): any sized image, lock
    // or no lock - a locked box already matches the natural ratio, so writing
    // it out changes nothing here and keeps editor and export in step.
    const objectFit = this.node.attrs.objectFit as ImageObjectFit;
    this.img.style.objectFit = objectFit && (width != null || height != null) ? objectFit : "";
    const caption = (this.node.attrs.caption as string) ?? "";
    this.captionEl.textContent = caption;
    if (caption) {
      if (!this.captionEl.isConnected) this.dom.appendChild(this.captionEl);
    } else if (this.captionEl.isConnected) {
      this.captionEl.remove();
    }
    // Switches `dom` to `display: table` (content-shadow-styles.ts's
    // `.has-caption`) only once there's actually a caption to wrap - the
    // same table/table-caption trick `html.ts`'s `imageChildHtml` exports,
    // needed so a caption longer than the image wraps instead of stretching
    // the wrapper wider than it (a plain `inline-block` wrapper sizes itself
    // to the caption's unwrapped max-content width, not the image's).
    this.dom.classList.toggle("has-caption", !!caption);
    this.renderAlign(this.node.attrs.align as ImageAlign | null);
  }

  /**
   * Applied to `this.dom` (the node view's own root, tracked by ProseMirror)
   * rather than `this.img` - ported from drystack's `imageContainerAlignStyle`,
   * whose comment explains why: floating the inner `<img>` alone would take
   * it out of flow while leaving this outer wrapper in flow with nothing to
   * size itself by, collapsing it to a zero-size box at the image's text
   * position. `left`/`right` just float the wrapper (already `inline-block`
   * via content-shadow-styles.ts's `.dry-tx-image-wrapper`, so floating changes nothing
   * else about its sizing); `center` stretches it to the paragraph's full
   * width via `min-width: 100%` (matching `schema.ts`'s `imageAlignStyleString`,
   * the exported HTML's own encoding of this) rather than `display: block` -
   * since the wrapper stays `inline-block` (not a block box), the `<img>`
   * inside it is still just inline content sitting at that box's start, so
   * `text-align: center` is what actually centers it within the now-full-
   * width wrapper (unlike a bare exported `<img>`, `schema.ts`'s case, which
   * has no such wrapper and needs none - `min-width: 100%` alone already
   * leaves it no room to be off-center).
   */
  private renderAlign(align: ImageAlign | null) {
    this.dom.style.float = align === "left" || align === "right" ? align : "";
    this.dom.style.minWidth = align === "center" ? "100%" : "";
    this.dom.style.textAlign = align === "center" ? "center" : "";
    // Longhand, not the `margin-inline` shorthand: unlike `margin-inline-start`/
    // `-end` below (which do take effect), assigning the shorthand's camelCase
    // form through `CSSStyleDeclaration` is a silent no-op in this app's target
    // browsers - confirmed via the RichTextField image-menu Playwright check.
    this.dom.style.marginInlineStart = align === "center" ? "auto" : align === "right" ? "1em" : "";
    this.dom.style.marginInlineEnd = align === "center" ? "auto" : align === "left" ? "1em" : "";
    this.dom.style.marginBlock = align === "left" || align === "right" ? "0.5em" : "";
    // `image-menu.tsx`'s floating per-image toolbar anchors to `imageBox`,
    // not `dom` - it needs the actual visible image's box, which the
    // wrapper's own bounding rect stops matching the moment `center` above
    // stretches it to the paragraph's full width. But every style write
    // above lands on `dom`, an *ancestor* of `imageBox` - `imageBox`'s own
    // size never changes (align only ever repositions it, via reflow from
    // that ancestor), so neither the toolbar's `ResizeObserver` nor its
    // `style`-attribute `MutationObserver` (both watching `imageBox`
    // itself, per `useTrackRect`) ever fire, and the toolbar drifts stale.
    // This custom property is a real `style` mutation on `imageBox` doing
    // nothing visually - just enough for that observer to notice the align
    // change and re-measure.
    this.imageBox.style.setProperty("--dry-image-align-ping", align ?? "");
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    // On `imageBox`, not `dom` - the outline/handles both need to track the
    // same box, and `dom` (which also holds the caption once one exists)
    // isn't it; see `.dry-tx-image-box`'s own doc comment in content-shadow-styles.ts.
    this.imageBox.classList.add("is-selected");
    for (const el of this.handleEls) this.imageBox.appendChild(el);
  }

  deselectNode() {
    this.imageBox.classList.remove("is-selected");
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
