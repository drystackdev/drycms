import { Fragment, type Node as PMNode, type NodeType } from "prosemirror-model";
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { iconBodies } from "../icons.js";
import { DEFAULT_GRID_COLUMNS, schema } from "./schema.js";

/**
 * "Reorder mode" - a toolbar toggle that turns every top-level-or-nested
 * block into a drag-and-drop-reorderable card: typing/formatting is
 * suspended (`useRichTextEditor.ts`'s `editable` reads `isReorderActive`),
 * every `group:"block"` node (paragraph/heading/blockquote/bullet_list/
 * ordered_list/table/grid - schema.ts) gets a light-gray background + a
 * drag handle pinned to its own top-left corner, `table`/`grid` (this
 * schema's only 2 "container" node types) additionally get an outline, and
 * any block can be dragged into any other container (including nested
 * grid/table cells) or back out to top level. Cmd/Ctrl+click on a handle
 * multi-selects several blocks to drag as one batch.
 *
 * State lives in this plugin (not Preact state, unlike `fullscreen` in
 * `RichTextField.tsx`) since `editable` and `decorations` both need to read
 * it synchronously off `EditorState`. Modeled on `grid-resize.ts`/
 * `table-column-resize.ts`'s shape: a `PluginKey`, meta-driven `apply`, and
 * hand-rolled pointerdown/pointermove/pointerup dragging (not native HTML5
 * `dragstart`/`drop` - matches every other drag-like interaction in this
 * field, and how `e2e/richtext-grid.spec.ts` already simulates drags via
 * `page.mouse.move/down/move/up`, not synthetic `dragstart`/`drop` events).
 */

export interface DropTarget {
  /** `replaceGridItem`/`afterGridItem`: `pos` is the doc position of an
   * *occupied* `grid_item` under the pointer - `replaceGridItem` when its
   * one child is itself empty (matches `insertBlockAfterFocusedGridItem`'s
   * own "replace in place" convention in grid.ts), `afterGridItem`
   * otherwise (append new sibling cell(s) after it - never before, same
   * "always after" convention that function already uses; grid items can
   * sit side-by-side via `colSpan`, so a Y-midpoint before/after check
   * isn't meaningful there anyway). `before`/`after`: `pos` is the doc
   * position of the specific hovered sibling (in `doc`/a `table_cell`/a
   * `list_item`/an *empty* `grid_item`'s slot), decided by pointer Y vs.
   * that sibling's own vertical midpoint. */
  kind: "replaceGridItem" | "afterGridItem" | "before" | "after";
  pos: number;
}

interface ReorderDragging {
  /** Doc positions of the dragged block(s), captured at drag start -
   * stays valid for the drag's whole lifetime since nothing else can
   * mutate the doc while `active` (`editable` is false) and the live
   * hover-highlight preview only ever touches this plugin's own meta
   * state, never `doc.content`. */
  positions: number[];
  target: DropTarget | null;
}

interface ReorderState {
  active: boolean;
  /** Doc positions of every block currently multi-selected via
   * Cmd/Ctrl+click on its handle - sorted ascending. */
  selected: number[];
  dragging: ReorderDragging | null;
}

const EMPTY_STATE: ReorderState = { active: false, selected: [], dragging: null };

export const reorderModeKey = new PluginKey<ReorderState>("reorderMode");

export function isReorderActive(state: EditorState): boolean {
  return reorderModeKey.getState(state)?.active ?? false;
}

export function getReorderSelection(state: EditorState): number[] {
  return reorderModeKey.getState(state)?.selected ?? [];
}

/** Toggles reorder mode on/off - clears any multi-selection when turning
 * off, same "leaving the mode resets its own transient state" idiom
 * `grid-resize.ts`'s `highlightLine` uses. */
export function toggleReorderMode(): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(reorderModeKey, { toggle: !isReorderActive(state) }));
    return true;
  };
}

function isBlockGroupNode(node: PMNode): boolean {
  return node.type.spec.group === "block";
}

/** Whether `pos` falls inside (or exactly at) any of the currently-dragged
 * nodes' own ranges - guards against a nonsensical/corrupting drop (e.g.
 * dropping a grid onto one of its own descendant cells), by rejecting that
 * position as a valid target entirely rather than trying to special-case
 * the fallout. */
function isInsideDraggedRange(doc: PMNode, pos: number, draggedPositions: number[]): boolean {
  return draggedPositions.some((dragPos) => {
    const node = doc.nodeAt(dragPos);
    return node != null && pos >= dragPos && pos < dragPos + node.nodeSize;
  });
}

function buildDecorations(state: EditorState, pluginState: ReorderState): DecorationSet {
  if (!pluginState.active) return DecorationSet.empty;
  const selectedSet = new Set(pluginState.selected);
  const draggedSet = new Set(pluginState.dragging?.positions ?? []);
  const target = pluginState.dragging?.target ?? null;
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (isBlockGroupNode(node)) {
      const isContainer = node.type === schema.nodes.grid || node.type === schema.nodes.table;
      const isDragged = draggedSet.has(pos);
      let className = "dry-tx-reorder-block";
      if (isContainer) className += " dry-tx-reorder-container";
      if (selectedSet.has(pos)) className += " dry-tx-reorder-selected";
      if (isDragged) className += " dry-tx-reorder-dragging";
      if (target && (target.kind === "before" || target.kind === "after") && target.pos === pos) {
        className += target.kind === "before" ? " dry-tx-reorder-drop-before" : " dry-tx-reorder-drop-after";
      }
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: className, style: "position:relative" }));
      if (!isDragged) {
        decorations.push(
          Decoration.widget(pos + 1, (view) => buildHandle(view), { side: -1, stopEvent: () => true }),
        );
      }
    } else if (
      node.type === schema.nodes.grid_item &&
      target &&
      (target.kind === "afterGridItem" || target.kind === "replaceGridItem") &&
      target.pos === pos
    ) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "dry-tx-reorder-drop-target" }));
    }
    return true;
  });

  return DecorationSet.create(state.doc, decorations);
}

function buildHandle(view: EditorView): HTMLElement {
  const handle = document.createElement("span");
  handle.className = "dry-tx-reorder-handle";
  handle.setAttribute("aria-hidden", "true");
  handle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14">${iconBodies.DragHandle.body}</svg>`;
  handle.addEventListener("pointerdown", (event) => onHandlePointerDown(view, handle, event));
  return handle;
}

/** The doc position immediately before `dom` itself - found via its own
 * index among its parent's DOM children (not `posAtDOM(dom, 0)`, which
 * would resolve to the position *inside* its content instead), the
 * standard robust technique for "what position does this specific DOM
 * node's own decoration/NodeView sit at". */
function posBeforeElement(view: EditorView, dom: Element): number | null {
  const parent = dom.parentNode;
  if (!parent) return null;
  const index = Array.prototype.indexOf.call(parent.childNodes, dom);
  if (index < 0) return null;
  try {
    return view.posAtDOM(parent, index);
  } catch {
    return null;
  }
}

/** `elementFromPoint`, not `event.target` - `useRichTextEditor.ts` mounts the
 * whole editor inside a shadow root, and a `pointermove` listener attached
 * on `window` (needed since the pointer can leave the original element
 * mid-drag, same as every other drag in this field) gets a *retargeted*
 * event whose `.target` is just the shadow host, not the actual hovered
 * element inside the shadow tree.
 *
 * `document.elementFromPoint` alone isn't enough either, though: per the
 * DOM spec it stops at the first (open) shadow *host* it hits rather than
 * descending into the tree - the same retargeting `event.target` does, just
 * for a different API. `ShadowRoot` has its own `elementFromPoint`, which
 * *does* resolve within that specific tree - so this walks `document` →
 * shadow root → nested shadow root (as many times as the result itself
 * turns out to host one) until the answer stops changing. This field only
 * ever nests one shadow root deep in practice, but the loop costs nothing
 * and doesn't assume that stays true. */
function elementAtPoint(clientX: number, clientY: number): Element | null {
  let el = document.elementFromPoint(clientX, clientY);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(clientX, clientY);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function computeDropTarget(view: EditorView, draggedPositions: number[], event: PointerEvent): DropTarget | null {
  const el = elementAtPoint(event.clientX, event.clientY);
  if (!el) return null;
  const doc = view.state.doc;

  const gridItemEl = el.closest(".dry-tx-grid-item");
  if (gridItemEl) {
    const gridItemPos = posBeforeElement(view, gridItemEl);
    if (gridItemPos != null && !isInsideDraggedRange(doc, gridItemPos, draggedPositions)) {
      const node = doc.nodeAt(gridItemPos);
      if (node && node.type === schema.nodes.grid_item) {
        const inner = node.firstChild;
        const innerEmpty = !inner || inner.content.size === 0;
        return { kind: innerEmpty ? "replaceGridItem" : "afterGridItem", pos: gridItemPos };
      }
    }
  }

  const blockEl = el.closest(".dry-tx-reorder-block");
  if (!blockEl) return null;
  const blockPos = posBeforeElement(view, blockEl);
  if (blockPos == null || isInsideDraggedRange(doc, blockPos, draggedPositions)) return null;
  const rect = blockEl.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  return { kind: before ? "before" : "after", pos: blockPos };
}

function dropTargetsEqual(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.pos === b.pos;
}

/** The full range to delete to remove `pos`'s own node entirely, extended
 * outward through an enclosing `grid_item`/`list_item` (and cascading
 * through an enclosing `grid`/`bullet_list`/`ordered_list` too, as long as
 * each is the ONLY remaining child) whenever `pos`'s node is that wrapper's
 * last piece of content - a plain `tr.delete` of just the leaf, left to
 * ProseMirror's own schema-fitting, does NOT leave the wrapper empty for a
 * later pass to clean up: it silently auto-fills a blank paragraph into it
 * right there in the same step (confirmed empirically - the replace
 * algorithm treats "keep this required child slot filled" as its own job
 * to do, not something a caller gets to observe and react to afterward).
 * That auto-fill is exactly what's wanted for a `table_cell`/`table_header`
 * (which can never be removed on its own without desyncing the table's
 * row/column grid - so this walk deliberately stops there, one leaf-only
 * delete, matching that node's own hard structural constraint) but NOT for
 * `grid_item`/`list_item`: the user's own confirmed behavior is "the empty
 * slot disappears", which only happens if the wrapper itself is included in
 * the SAME delete call before ProseMirror ever gets a chance to auto-fill
 * it - there is no "delete the leaf, then delete the now-empty wrapper
 * separately" two-step version of this that works, since step one never
 * actually produces an empty wrapper to find. */
function removableRange(doc: PMNode, pos: number): { from: number; to: number } {
  let $pos = doc.resolve(pos);
  let from = pos;
  let to = pos + $pos.nodeAfter!.nodeSize;
  while ($pos.depth > 0) {
    const parent = $pos.parent;
    if (parent.type === schema.nodes.table_cell || parent.type === schema.nodes.table_header) break;
    if (parent.childCount > 1) break;
    const parentPos = $pos.before($pos.depth);
    from = parentPos;
    to = parentPos + parent.nodeSize;
    $pos = doc.resolve(parentPos);
  }
  return { from, to };
}

/** The node a dragged block needs wrapped in to become valid content of
 * `containerType` - `grid`'s content is `grid_item+` (never a bare block),
 * `bullet_list`/`ordered_list`'s is `list_item+` - every other container
 * this field has (`doc`, `table_cell`/`table_header`, `list_item`) accepts a
 * `group:"block"` node directly, no wrapper needed. */
function wrapForTarget(node: PMNode, containerType: NodeType): PMNode {
  if (containerType === schema.nodes.bullet_list || containerType === schema.nodes.ordered_list) {
    return schema.nodes.list_item!.create(null, node);
  }
  return node;
}

function insertDraggedNodes(tr: Transaction, target: DropTarget, nodes: PMNode[]): void {
  if (target.kind === "replaceGridItem" || target.kind === "afterGridItem") {
    let itemPos = target.pos;
    let remaining = nodes;
    if (target.kind === "replaceGridItem") {
      const gridItemNode = tr.doc.nodeAt(itemPos)!;
      const inner = gridItemNode.firstChild!;
      tr.replaceWith(itemPos + 1, itemPos + 1 + inner.nodeSize, nodes[0]!);
      remaining = nodes.slice(1);
    }
    for (const node of remaining) {
      const gridItemNode = tr.doc.nodeAt(itemPos)!;
      const insertAt = itemPos + gridItemNode.nodeSize;
      const wrapped = schema.nodes.grid_item!.create({ colSpan: DEFAULT_GRID_COLUMNS, rowSpan: 1 }, node);
      tr.insert(insertAt, wrapped);
      itemPos = insertAt;
    }
    return;
  }

  const targetNode = tr.doc.nodeAt(target.pos)!;
  const insertAt = target.kind === "before" ? target.pos : target.pos + targetNode.nodeSize;
  const containerType = tr.doc.resolve(insertAt).parent.type;
  let insertPos = insertAt;
  for (const node of nodes) {
    const wrapped = wrapForTarget(node, containerType);
    tr.insert(insertPos, wrapped);
    insertPos += wrapped.nodeSize;
  }
}

/** The pure transaction-building half of a reorder move - deletes every
 * dragged node (via `removableRange`, so an emptied `grid_item`/`list_item`
 * disappears instead of getting auto-filled - see that function's own doc
 * comment), then inserts the dragged nodes at the (remapped) drop target.
 * Split out from `commitReorderMove` below so it can be unit tested
 * directly against a plain `EditorState` (no live `EditorView`/DOM needed) -
 * same "pure command logic tested directly, DOM-touching parts covered by
 * Playwright instead" split `grid.test.ts` already uses for `grid.ts`. */
export function buildReorderTransaction(state: EditorState, positions: number[], target: DropTarget): Transaction {
  const sorted = [...positions].sort((a, b) => a - b);
  const nodes = sorted.map((pos) => state.doc.nodeAt(pos)!);

  const tr = state.tr;
  // Descending, and `removableRange` recomputed against `tr.doc` (not the
  // original, pre-transaction doc) on every iteration - not just for
  // mapping's sake, but so a parent shared by more than one dragged node
  // (e.g. multi-selecting both items of a 2-item grid) still cascades away
  // correctly on its 2nd (or 3rd, ...) dragged child: it wouldn't have
  // looked empty yet judged only against the untouched original doc, only
  // against the version with its OTHER dragged sibling(s) already removed.
  for (const originalPos of [...sorted].reverse()) {
    const pos = tr.mapping.map(originalPos);
    const { from, to } = removableRange(tr.doc, pos);
    tr.delete(from, to);
  }

  const targetPos = tr.mapping.map(target.pos);
  insertDraggedNodes(tr, { ...target, pos: targetPos }, nodes);

  if (tr.doc.childCount === 0) tr.insert(0, schema.nodes.paragraph!.createAndFill()!);

  return tr;
}

function commitReorderMove(view: EditorView, positions: number[], target: DropTarget): void {
  const tr = buildReorderTransaction(view.state, positions, target);
  tr.setMeta(reorderModeKey, { setDragging: null, setSelected: [] });
  view.dispatch(tr.scrollIntoView());
}

function startReorderDrag(view: EditorView, positions: number[], event: PointerEvent): void {
  const win = view.dom.ownerDocument.defaultView ?? window;
  view.dispatch(view.state.tr.setMeta(reorderModeKey, { setDragging: { positions, target: null } }));

  const move = (moveEvent: PointerEvent) => {
    const pluginState = reorderModeKey.getState(view.state);
    if (!pluginState?.dragging) return;
    const nextTarget = computeDropTarget(view, positions, moveEvent);
    if (!dropTargetsEqual(nextTarget, pluginState.dragging.target)) {
      const tr = view.state.tr.setMeta(reorderModeKey, { setDragging: { positions, target: nextTarget } });
      view.updateState(view.state.apply(tr));
    }
  };
  const finish = (upEvent: PointerEvent) => {
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", finish);
    const pluginState = reorderModeKey.getState(view.state);
    const target = pluginState?.dragging?.target ?? computeDropTarget(view, positions, upEvent);
    if (target) commitReorderMove(view, positions, target);
    else view.dispatch(view.state.tr.setMeta(reorderModeKey, { setDragging: null }));
  };
  win.addEventListener("pointermove", move);
  win.addEventListener("pointerup", finish);
}

function onHandlePointerDown(view: EditorView, handle: HTMLElement, event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const pos = posBeforeElement(view, handle.parentElement!);
  if (pos == null) return;
  const pluginState = reorderModeKey.getState(view.state);
  if (!pluginState?.active) return;

  if (event.metaKey || event.ctrlKey) {
    const selected = pluginState.selected.includes(pos)
      ? pluginState.selected.filter((p) => p !== pos)
      : [...pluginState.selected, pos].sort((a, b) => a - b);
    view.dispatch(view.state.tr.setMeta(reorderModeKey, { setSelected: selected }));
    return;
  }

  const positions = pluginState.selected.includes(pos) && pluginState.selected.length > 1 ? pluginState.selected : [pos];
  if (positions.length === 1 && (pluginState.selected.length !== 1 || pluginState.selected[0] !== pos)) {
    view.dispatch(view.state.tr.setMeta(reorderModeKey, { setSelected: positions }));
  }
  startReorderDrag(view, positions, event);
}

export function reorderMode(): Plugin<ReorderState> {
  return new Plugin<ReorderState>({
    key: reorderModeKey,
    state: {
      init: () => EMPTY_STATE,
      apply(tr, prev) {
        const meta = tr.getMeta(reorderModeKey);
        if (meta) {
          if ("toggle" in meta) return meta.toggle ? { active: true, selected: [], dragging: null } : EMPTY_STATE;
          // Not `if`/`else if` - `commitReorderMove` sets BOTH `setSelected`
          // and `setDragging` on the same meta object (clearing the
          // selection and the just-finished drag together), and both need
          // to actually apply rather than the first key checked winning and
          // returning early, silently dropping the other.
          let next = prev;
          if ("setSelected" in meta) next = { ...next, selected: meta.setSelected as number[] };
          if ("setDragging" in meta) next = { ...next, dragging: meta.setDragging as ReorderDragging | null };
          return next;
        }
        if (tr.docChanged && (prev.selected.length > 0 || prev.dragging)) {
          const selected = prev.selected
            .map((pos) => tr.mapping.map(pos, -1))
            .filter((pos) => {
              const node = tr.doc.nodeAt(pos);
              return node != null && isBlockGroupNode(node);
            });
          return { ...prev, selected, dragging: null };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return buildDecorations(state, reorderModeKey.getState(state) ?? EMPTY_STATE);
      },
    },
  });
}
