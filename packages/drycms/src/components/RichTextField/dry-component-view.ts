import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";

/**
 * Mounts a `<dry-{name}>` custom element (already registered by
 * `useRichTextEditor.ts` via `defineDryComponent`) as this node's own DOM -
 * pattern ported from `image-view.ts` (`selectNode`/`deselectNode` toggling
 * an outline class), but simpler: no drag/resize state, and no children to
 * project (this node is a leaf, see `schema.ts`'s `buildDryNodeSpecs`).
 *
 * `ignoreMutation` is unconditionally `true`, unlike `image-view.ts`'s
 * event-conditional version - the custom element's own subtree is rendered
 * and re-rendered entirely by Preact (the component author's own code, not
 * this file), so ProseMirror must never try to diff/reconcile any of it as
 * document content, not just during a specific interaction like a drag.
 *
 * The explicit `mousedown` -> `NodeSelection` below is NOT the same
 * "free from ProseMirror's own default atom-click handling" `image`/`table`
 * get - confirmed empirically (Playwright, real `page.mouse.click`): PM's
 * built-in click-to-select walk only reliably resolves when the click lands
 * on a DOM node it itself tracks. `image`'s own children are just the bare
 * `<img>` (+ resize handles PM never sees either, but nothing to click by
 * default); this node's whole subtree is Preact-rendered *after*
 * construction and entirely opaque to PM's `docView`, so a click landing on
 * any of it (near guaranteed - the custom element itself rarely has any
 * exposed hit area of its own) falls through to a plain text-position click
 * instead. Selecting explicitly here, on the outer element in the capture-
 * ish sense of "any mousedown inside this subtree", sidesteps that walk
 * entirely rather than depending on it.
 */
export class DryComponentNodeView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;

  constructor(node: PMNode, tag: string, type: "inline" | "block", view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.dom = document.createElement(tag);
    // A custom element has no default UA style beyond plain `inline` (same
    // as any unrecognized tag) - without an explicit box, `.selectNode()`'s
    // outline below has nothing real to trace around, and can end up
    // invisible depending on what the component's own root children do
    // layout-wise. `inline-block` for `inline` nodes keeps them sitting in
    // text flow like `image`'s own `.dry-tx-image-wrapper`; `block` nodes
    // get a real block box, matching every other top-level block node here.
    this.dom.style.display = type === "block" ? "block" : "inline-block";
    this.dom.addEventListener("mousedown", (event) => {
      const pos = getPos();
      if (pos === undefined) return;
      event.preventDefault();
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    });
    this.render();
  }

  private render() {
    this.dom.setAttribute("props", JSON.stringify(this.node.attrs.props));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    // Own class, not `.is-selected` - that name already means something
    // different on `.dry-tx-image-box`/grid items (content-shadow-styles.ts),
    // and unlike those this class lives directly on the selected element
    // itself (a dynamic `dry-{name}` tag, not a fixed wrapper class), so a
    // shared name risks colliding with unrelated CSS some component author's
    // own styles might define.
    this.dom.classList.add("dry-component-is-selected");
  }

  deselectNode() {
    this.dom.classList.remove("dry-component-is-selected");
  }

  ignoreMutation(): boolean {
    return true;
  }

  /** Tells ProseMirror not to run its OWN default `mousedown` handling on
   * top of the listener above - without this, PM's own click-to-select walk
   * still runs afterward (bubbling reaches `view.dom` after this node's own
   * listener), and since it can't reliably resolve a click landing inside
   * Preact-rendered descendant DOM (see this class's own doc comment), it
   * overwrites the `NodeSelection` just dispatched with an ordinary text
   * cursor position instead - same `stopEvent` use as `image-view.ts`'s own
   * resize handles, just for a different reason (there: don't treat a drag
   * as text selection; here: don't fight this node's own click handling). */
  stopEvent(event: Event): boolean {
    return event.type === "mousedown";
  }
}
