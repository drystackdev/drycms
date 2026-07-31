import { DOMSerializer, type Node as PMNode } from "prosemirror-model";
import type { NodeView, ViewMutationRecord } from "prosemirror-view";
import { colgroupDOMSpec } from "./schema.js";

/**
 * Custom `NodeView` for `table`, existing purely to override `ignoreMutation`
 * - rendering is otherwise identical to the plain `toDOM` this replaces
 * (built from the exact same spec, via `DOMSerializer.renderSpec`).
 *
 * ProseMirror's default `ignoreMutation` (`!contentDOM && type != "selection"`)
 * never ignores attribute mutations on a content-holding node (this one's
 * `contentDOM` - the `<tbody>` - is never null), so its `DOMObserver` treats
 * `table-column-resize.ts`'s live drag preview (which writes `style.width`
 * directly onto `<col>` elements, deliberately outside any transaction - see
 * that file's own `applyLiveWidths`) as an unexpected external change and
 * reverts it by re-rendering the table from state on the very next
 * microtask, before the new width is ever visible. Ignoring attribute
 * mutations specifically targeting a `<col>` here is what lets that live
 * preview actually survive on screen.
 */
export class TableNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private tableEl: HTMLTableElement;

  constructor(node: PMNode) {
    this.node = node;
    const { dom, contentDOM, tableEl } = TableNodeView.render(node);
    this.dom = dom;
    this.contentDOM = contentDOM;
    this.tableEl = tableEl;
  }

  private static render(node: PMNode): { dom: HTMLElement; contentDOM: HTMLElement; tableEl: HTMLTableElement } {
    const spec = node.type.spec.toDOM!(node);
    const { dom, contentDOM } = DOMSerializer.renderSpec(document, spec) as { dom: HTMLElement; contentDOM?: HTMLElement };
    return { dom, contentDOM: contentDOM!, tableEl: dom.querySelector(":scope > table")! };
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    if (node.attrs.caption !== this.node.attrs.caption || node.attrs.colWidths !== this.node.attrs.colWidths) {
      // Only the `<caption>`/`<colgroup>` siblings of `contentDOM` get
      // rebuilt - `contentDOM` (`<tbody>`) itself is left untouched, since
      // it's the only part of this node's DOM ProseMirror actually tracks;
      // replacing it (rather than mutating around it) would invalidate
      // every row/cell view desc beneath it.
      this.tableEl.querySelectorAll(":scope > caption, :scope > colgroup").forEach((el) => el.remove());
      const caption = node.attrs.caption as string;
      if (caption) {
        const captionEl = document.createElement("caption");
        captionEl.contentEditable = "false";
        captionEl.textContent = caption;
        this.tableEl.insertBefore(captionEl, this.tableEl.firstChild);
      }
      const colgroupSpec = colgroupDOMSpec(node.attrs.colWidths as number[] | null);
      if (colgroupSpec) {
        const { dom: colgroupEl } = DOMSerializer.renderSpec(document, colgroupSpec) as { dom: HTMLElement };
        this.tableEl.insertBefore(colgroupEl, this.contentDOM);
      }
    }
    this.node = node;
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== "selection" && (mutation.target as Element).nodeName === "COL";
  }
}
