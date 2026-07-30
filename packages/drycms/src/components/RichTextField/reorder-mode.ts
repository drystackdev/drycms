import { Fragment, type Node as PMNode, type NodeType } from "prosemirror-model";
import { Plugin, PluginKey, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { DEFAULT_GRID_COLUMNS, schema } from "./schema.js";

/**
 * "Reorder mode" - a toolbar toggle that turns every top-level-or-nested
 * block into a drag-and-drop-reorderable card: typing/formatting is
 * suspended (`useRichTextEditor.ts`'s `editable` reads `isReorderActive`),
 * every `group:"block"` node (paragraph/heading/blockquote/bullet_list/
 * ordered_list/table/grid/dry-component - schema.ts) gets a light-gray
 * background, padding/border/margin (so adjacent and nested blocks read as
 * visually distinct cards), and can be dragged by a pointerdown anywhere on
 * itself (`onBlockPointerDown`'s `handleDOMEvents`) - there is no separate
 * drag handle; `closest(".dry-tx-reorder-block")` from the pointerdown
 * target naturally resolves to whichever block (a nested child, or the
 * container around it) sits closest to where the pointer actually landed.
 * Cmd/Ctrl+click multi-selects several blocks to drag as one batch.
 *
 * A "container" node - `grid`, or any `children:true` dry component
 * (identified generically by `content === "block+"`, the shape
 * `buildDryNodeSpecs` in schema.ts gives those - see `isContainerNode`) -
 * additionally gets an outline. `table` is deliberately NOT a container by
 * this definition: it's one atomic block (its content is `table_row+`, never
 * a bare block), and nothing can be dropped directly into it - only into one
 * of its cells (`table_cell`/`table_header`), which aren't `group:"block"`
 * nodes and so never independently drag or carry this decoration; they're
 * still valid drop *targets* though, same as any other container's interior
 * (see `wrapForTarget`/`insertDraggedNodes`).
 *
 * A secondary toolbar (`reorder-mode-menu.tsx`) lets the user pick one of
 * three modes while reorder mode is active (`ReorderModeValue`, default
 * `"block"`):
 * - `"block"`: today's fully permissive behavior - any block can be dragged
 *   and dropped anywhere, including into a container.
 * - `"container"`: still any block can be dragged, but a drop is only
 *   accepted at the SAME structural level the dragged block started at (no
 *   dropping into a container it wasn't already inside) - see `scopeAnchor`/
 *   `sharedScope` and `computeDropTarget`'s `mode === "container"` filter.
 * - `"nested-container"`: the mirror image - only container nodes can be
 *   dragged at all (a pointerdown on a non-container block is a no-op, see
 *   `onBlockPointerDown`; those blocks also get a `dry-tx-reorder-frozen`
 *   decoration), but with no level restriction, so a container can be
 *   dropped inside another container to nest it.
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
   * isn't meaningful there anyway). `replaceCellContent`: `pos` is the doc
   * position of a table cell's own lone empty placeholder block (the
   * auto-fill `removableRange` leaves behind when a cell's last real block
   * gets dragged out) - the cell's one and only reason to still exist, so a
   * block dropped there replaces it outright rather than becoming a second,
   * pointless sibling (see `computeRawDropTarget`). `before`/`after`: `pos`
   * is the doc position of the specific hovered sibling (in `doc`/a
   * `table_cell`/a `list_item`/an *empty* `grid_item`'s slot), decided by
   * pointer Y vs. that sibling's own vertical midpoint. */
  kind: "replaceGridItem" | "afterGridItem" | "replaceCellContent" | "before" | "after";
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
  /** Combined `getBoundingClientRect().height` of every dragged block,
   * measured once at drag start (before `dry-tx-reorder-dragging` hides
   * them) - sizes the "ghost slot" widget `buildDecorations` inserts at
   * whatever `before`/`after` target is currently hovered (see
   * `buildGhostWidget`). The ProseMirror-native equivalent of
   * `lib/dnd/useSortableList.ts` moving its own placeholder row live to the
   * target index: that hook can just reorder its backing array and let
   * Preact's keyed reconciliation relocate the real row, but this plugin
   * never touches `doc.content` until the drop actually commits (see this
   * file's own top doc comment) - a widget decoration standing in for
   * "where the real thing will land" is the equivalent move here. */
  height: number;
}

/** `"block"` (default): any block can be dragged and dropped anywhere,
 * including into a container. `"container"`: any block can still be
 * dragged, but a drop is only accepted at the same structural level it
 * started at (see `scopeAnchor`/`sharedScope`). `"nested-container"`: only
 * container nodes (`isContainerNode`) can be dragged at all, with no level
 * restriction - lets one container be nested inside another. See this
 * file's own top doc comment for the full picture. */
export type ReorderModeValue = "block" | "container" | "nested-container";

interface ReorderState {
  active: boolean;
  mode: ReorderModeValue;
  /** Doc positions of every block currently multi-selected via
   * Cmd/Ctrl+click - sorted ascending. */
  selected: number[];
  dragging: ReorderDragging | null;
}

const EMPTY_STATE: ReorderState = { active: false, mode: "block", selected: [], dragging: null };

export const reorderModeKey = new PluginKey<ReorderState>("reorderMode");

export function isReorderActive(state: EditorState): boolean {
  return reorderModeKey.getState(state)?.active ?? false;
}

export function getReorderMode(state: EditorState): ReorderModeValue {
  return reorderModeKey.getState(state)?.mode ?? "block";
}

export function getReorderSelection(state: EditorState): number[] {
  return reorderModeKey.getState(state)?.selected ?? [];
}

/** Toggles reorder mode on/off - clears any multi-selection and resets the
 * mode back to its `"block"` default when turning off, same "leaving the
 * mode resets its own transient state" idiom `grid-resize.ts`'s
 * `highlightLine` uses. */
export function toggleReorderMode(): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(reorderModeKey, { toggle: !isReorderActive(state) }));
    return true;
  };
}

/** Switches the active mode - a no-op (returns `false`) while reorder mode
 * itself is off, since the mode selector only renders while it's active. */
export function setReorderMode(mode: ReorderModeValue): Command {
  return (state, dispatch) => {
    if (!isReorderActive(state)) return false;
    if (dispatch) dispatch(state.tr.setMeta(reorderModeKey, { setMode: mode }));
    return true;
  };
}

function isBlockGroupNode(node: PMNode): boolean {
  return node.type.spec.group === "block";
}

/** `grid`, or a `children:true` dry component - the latter is the only OTHER
 * `group:"block"` node whose `content` spec is exactly `"block+"`
 * (`buildDryNodeSpecs` in schema.ts; every other block-group node either has
 * no content at all, or a narrower one like `"inline*"`/`"list_item+"`), so
 * checking that string is a generic stand-in for "is a dry component with
 * `children: true`" without importing the component registry here. `table`
 * is NOT a container by this definition - its content is `table_row+`, not
 * `block+`, since nothing can drop directly into a table, only into one of
 * its cells (see this file's own top doc comment). */
export function isContainerNode(node: PMNode): boolean {
  return node.type === schema.nodes.grid || node.type.spec.content === "block+";
}

/** The empty paragraph `insertTable`/`insertGrid`/`moveAfterGrid`/`table.ts`'s
 * own equivalent add after a table/grid landing at the very end of the
 * document, purely so there's somewhere left to put the cursor - not a real
 * piece of content, so `buildDecorations` hides it outright (`dry-tx-reorder-
 * hidden`) rather than showing it as just another card, for the same reason
 * it's never draggable. `pos + node.nodeSize === doc.content.size` catches
 * only a TOP-LEVEL trailing paragraph; a doc-final but nested empty
 * paragraph, e.g. the last block inside the last container, is real content
 * and stays visible/draggable - the `doc.resolve(pos).depth === 0` check is
 * what tells the two apart. */
export function isTrailingEmptyParagraph(doc: PMNode, pos: number, node: PMNode): boolean {
  if (node.type !== schema.nodes.paragraph || node.content.size !== 0) return false;
  if (pos + node.nodeSize !== doc.content.size) return false;
  return doc.resolve(pos).depth === 0;
}

/** Whether `node` at `pos` can be picked up and dragged at all, under
 * `mode` - enforced by `onBlockPointerDown`. The trailing landing-spot
 * paragraph (hidden, so never reachable by a pointerdown anyway - see
 * `isTrailingEmptyParagraph`) is excluded defensively too; a non-container
 * is additionally undraggable under `"nested-container"`, which only lets
 * containers move (see `buildDecorations`'s `dry-tx-reorder-frozen` class,
 * its visible counterpart). */
export function isDraggableNode(doc: PMNode, pos: number, node: PMNode, mode: ReorderModeValue): boolean {
  if (isTrailingEmptyParagraph(doc, pos, node)) return false;
  if (mode === "nested-container") return isContainerNode(node);
  return true;
}

/** A comparable "which level of nesting" key for `pos`, used by
 * `"container"` mode's flat-reorder restriction: `-1` for a position whose
 * node lives at the doc's top level, otherwise the doc position of whichever
 * ancestor most directly groups it with its reorder-siblings. A `grid_item`
 * child is scoped to the *grid* itself - `grid_item` is structural plumbing
 * a user never directly sees or targets (see `wrapForTarget`), so a block's
 * real siblings are the grid's OTHER items, not "the rest of this specific
 * grid_item" (which can never have more than one child anyway). Everything
 * else is scoped to its own immediate parent node - a specific table_cell/
 * dry component/list_item/bullet_list, or (for a `target.pos` that's itself
 * a grid_item, i.e. a `"replaceGridItem"`/`"afterGridItem"` target) the grid
 * that directly holds it. */
export function scopeAnchor(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos);
  let depth = $pos.depth;
  if (depth === 0) return -1;
  if ($pos.parent.type === schema.nodes.grid_item && depth > 1) depth -= 1;
  return $pos.before(depth);
}

/** The single scope every one of `positions` shares, or `null` if they don't
 * all agree (e.g. a multi-selection spanning two different containers) -
 * `"container"` mode then has no valid target for the drag at all, rather
 * than picking one dragged block's scope arbitrarily and silently ignoring
 * the mismatch for the others. */
export function sharedScope(doc: PMNode, positions: number[]): number | null {
  const scopes = positions.map((pos) => scopeAnchor(doc, pos));
  return scopes.every((scope) => scope === scopes[0]) ? (scopes[0] ?? null) : null;
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

/** The "ghost slot" widget dropped at whatever `before`/`after` target is
 * currently hovered (see `ReorderDragging.height`'s own doc comment for why
 * this exists) - a plain div sized to the dragged content's own combined
 * height, so the preview reads as "the real thing lands right here" rather
 * than just a thin edge highlight. `aria-hidden` and (content-shadow-
 * styles.ts) `pointer-events: none` - it isn't real content, doesn't
 * correspond to any doc position, and disappears the instant the drag
 * ends. */
function buildGhostWidget(height: number): (view: EditorView) => HTMLElement {
  return () => {
    const el = document.createElement("div");
    el.className = "dry-tx-reorder-ghost";
    el.style.height = `${height}px`;
    el.setAttribute("aria-hidden", "true");
    return el;
  };
}

function buildDecorations(state: EditorState, pluginState: ReorderState): DecorationSet {
  if (!pluginState.active) return DecorationSet.empty;
  const selectedSet = new Set(pluginState.selected);
  const draggedSet = new Set(pluginState.dragging?.positions ?? []);
  const target = pluginState.dragging?.target ?? null;
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (isBlockGroupNode(node)) {
      if (isTrailingEmptyParagraph(state.doc, pos, node)) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "dry-tx-reorder-hidden" }));
        return true;
      }
      const isContainer = isContainerNode(node);
      const isDragged = draggedSet.has(pos);
      let className = "dry-tx-reorder-block";
      if (isContainer) className += " dry-tx-reorder-container";
      if (pluginState.mode === "nested-container" && !isContainer) className += " dry-tx-reorder-frozen";
      if (selectedSet.has(pos)) className += " dry-tx-reorder-selected";
      if (isDragged) className += " dry-tx-reorder-dragging";
      if (target && target.pos === pos && (target.kind === "before" || target.kind === "after")) {
        className += target.kind === "before" ? " dry-tx-reorder-drop-before" : " dry-tx-reorder-drop-after";
        const widgetPos = target.kind === "before" ? pos : pos + node.nodeSize;
        decorations.push(
          Decoration.widget(widgetPos, buildGhostWidget(pluginState.dragging?.height ?? 0), {
            side: target.kind === "before" ? -1 : 1,
          }),
        );
      } else if (target && target.pos === pos && target.kind === "replaceCellContent") {
        className += " dry-tx-reorder-drop-target";
      }
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: className, style: "position:relative" }));
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

function computeRawDropTarget(view: EditorView, draggedPositions: number[], event: PointerEvent): DropTarget | null {
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
  if (!blockEl) {
    // Hovering a table cell's own padding rather than its (possibly much
    // smaller) lone block directly - `<td>`/`<th>` aren't `group:"block"`
    // nodes, so unlike `.dry-tx-grid-item` above they carry no decoration
    // of their own to `closest()` match against; this reaches straight for
    // the cell's single child instead of giving up, same "the cell's own
    // chrome still counts as a valid drop area" idea the grid-item branch
    // already gets for free from its own outline decoration.
    const cellEl = el.closest("td, th");
    const cellPos = cellEl ? posBeforeElement(view, cellEl) : null;
    const cellNode = cellPos != null ? doc.nodeAt(cellPos) : null;
    if (!cellNode || cellNode.childCount !== 1) return null;
    const childPos = cellPos! + 1;
    if (isInsideDraggedRange(doc, childPos, draggedPositions)) return null;
    const child = cellNode.firstChild!;
    return child.content.size === 0 ? { kind: "replaceCellContent", pos: childPos } : { kind: "after", pos: childPos };
  }
  const blockPos = posBeforeElement(view, blockEl);
  if (blockPos == null || isInsideDraggedRange(doc, blockPos, draggedPositions)) return null;

  // Hovering a table cell's own lone empty placeholder block - replace it
  // rather than landing a `before`/`after` sibling next to it (see
  // `DropTarget`'s own doc comment).
  const $blockPos = doc.resolve(blockPos);
  const parent = $blockPos.parent;
  const isSoleCellPlaceholder =
    (parent.type === schema.nodes.table_cell || parent.type === schema.nodes.table_header) &&
    parent.childCount === 1 &&
    doc.nodeAt(blockPos)!.content.size === 0;
  if (isSoleCellPlaceholder) return { kind: "replaceCellContent", pos: blockPos };

  const rect = blockEl.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  return { kind: before ? "before" : "after", pos: blockPos };
}

/** `computeRawDropTarget`, additionally filtered through `mode`: under
 * `"container"`, a candidate target is only accepted when it sits at the
 * SAME `scopeAnchor` every dragged position shares (`sharedScope`) - i.e.
 * the drop would leave the dragged block(s) at the level they started at,
 * never newly nested into (or out of) a container. `"block"` and
 * `"nested-container"` both accept whatever `computeRawDropTarget` finds,
 * unfiltered - the difference between those two modes is entirely about
 * which nodes are eligible to be dragged in the first place
 * (`isDraggableNode`, enforced by `onBlockPointerDown`), not about where a
 * given drag can land. */
function computeDropTarget(
  view: EditorView,
  draggedPositions: number[],
  event: PointerEvent,
  mode: ReorderModeValue,
): DropTarget | null {
  const target = computeRawDropTarget(view, draggedPositions, event);
  if (!target || mode !== "container") return target;
  const doc = view.state.doc;
  const requiredScope = sharedScope(doc, draggedPositions);
  if (requiredScope == null || scopeAnchor(doc, target.pos) !== requiredScope) return null;
  return target;
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
  if (target.kind === "replaceCellContent") {
    const placeholder = tr.doc.nodeAt(target.pos)!;
    tr.replaceWith(target.pos, target.pos + placeholder.nodeSize, nodes);
    return;
  }

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

function commitReorderMove(view: EditorView, positions: number[], target: DropTarget, overlayRect: DOMRect): void {
  // Same positions→nodes read `buildReorderTransaction` does internally,
  // captured here (off the same pre-transaction `view.state`) so
  // `playDropSettle` has the exact `Node` references to match against
  // post-dispatch - see that function's own doc comment.
  const sorted = [...positions].sort((a, b) => a - b);
  const nodes = sorted.map((pos) => view.state.doc.nodeAt(pos)!);
  const tr = buildReorderTransaction(view.state, positions, target);
  tr.setMeta(reorderModeKey, { setDragging: null, setSelected: [] });
  view.dispatch(tr.scrollIntoView());
  playDropSettle(view, nodes, overlayRect);
}

/** The pure transaction-building half of deleting every currently-selected
 * block/container - same descending, `tr.doc`-recomputed `removableRange`
 * delete loop `buildReorderTransaction` uses (see its own doc comment for
 * why), just without the "insert the dragged nodes back somewhere" half. */
export function buildDeleteTransaction(state: EditorState, positions: number[]): Transaction {
  const sorted = [...positions].sort((a, b) => a - b);
  const tr = state.tr;
  for (const originalPos of [...sorted].reverse()) {
    const pos = tr.mapping.map(originalPos);
    const { from, to } = removableRange(tr.doc, pos);
    tr.delete(from, to);
  }
  if (tr.doc.childCount === 0) tr.insert(0, schema.nodes.paragraph!.createAndFill()!);
  return tr;
}

/** Deletes every block/container currently selected (Cmd/Ctrl+click) in
 * reorder mode - a no-op while nothing's selected. Bound to both the
 * "Delete selected" toolbar button (`reorder-mode-menu.tsx`) and the
 * Delete/Backspace key (`reorderMode`'s own `handleKeyDown` below). */
export function deleteSelectedBlocks(): Command {
  return (state, dispatch) => {
    const pluginState = reorderModeKey.getState(state);
    if (!pluginState?.active || pluginState.selected.length === 0) return false;
    if (dispatch) {
      const tr = buildDeleteTransaction(state, pluginState.selected);
      tr.setMeta(reorderModeKey, { setSelected: [], setDragging: null });
      dispatch(tr);
    }
    return true;
  };
}

/** Sum of every dragged block's own rendered height - called at drag start,
 * before `dry-tx-reorder-dragging` hides them; `view.nodeDOM` (not a CSS
 * selector/decoration lookup) is the direct, always-correct way to get a
 * node's own root DOM element back from its doc position. Sizes the ghost
 * slot widget (`buildGhostWidget`/`ReorderDragging.height`). */
function draggedHeight(view: EditorView, positions: number[]): number {
  return positions.reduce((sum, pos) => {
    const dom = view.nodeDOM(pos);
    return sum + (dom instanceof HTMLElement ? dom.getBoundingClientRect().height : 0);
  }, 0);
}

/** Same spring-ish overshoot curve/duration `lib/dnd/useSortableList.ts`
 * uses for its own drop settle - reused verbatim so a drag anywhere in this
 * app reads as the same design language rather than inventing a second
 * "nice" curve. */
const DROP_SETTLE_MS = 220;
const DROP_SETTLE_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

interface DragOverlay {
  el: HTMLElement;
  originX: number;
  originY: number;
}

/** Clones every dragged block's own DOM into a floating, `position: fixed`
 * stack (in their relative doc order) that tracks the pointer - the same
 * "lift a real clone off the page" technique `lib/dnd/useSortableList.ts`
 * uses for the Fields list/DataTable rows (see that file's own top doc
 * comment), adapted for possibly SEVERAL dragged blocks at once (stacked
 * top to bottom, rather than that hook's single-row case) and for living
 * inside a shadow tree: appended into the SAME shadow root the content
 * itself renders in (`view.dom.getRootNode()`), not `document.body` - only
 * the shadow root's own `<style>` (content-shadow-styles.ts) carries
 * `.dry-tx-reorder-block`'s padding/border/tint and this field's own
 * `--dry-*` custom properties never make it into a plain `document.body`
 * append the way they cross the shadow boundary here. Read at drag start,
 * before `dry-tx-reorder-dragging` hides the real blocks (`display: none`,
 * see content-shadow-styles.ts), so every clone still shows real content. */
function buildDragOverlay(view: EditorView, positions: number[], event: PointerEvent): DragOverlay {
  const doc = view.dom.ownerDocument;
  const root = view.dom.getRootNode();
  const host: ShadowRoot | HTMLElement = root instanceof ShadowRoot ? root : doc.body;

  const wrapper = doc.createElement("div");
  wrapper.className = "dry-tx-reorder-overlay";
  wrapper.style.position = "fixed";

  const sorted = [...positions].sort((a, b) => a - b);
  const firstDom = view.nodeDOM(sorted[0]!);
  const firstRect = firstDom instanceof HTMLElement ? firstDom.getBoundingClientRect() : null;
  wrapper.style.top = `${firstRect?.top ?? event.clientY}px`;
  wrapper.style.left = `${firstRect?.left ?? event.clientX}px`;
  if (firstRect) wrapper.style.width = `${firstRect.width}px`;

  let offset = 0;
  for (const pos of sorted) {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) continue;
    const rect = dom.getBoundingClientRect();
    const clone = dom.cloneNode(true) as HTMLElement;
    clone.style.position = "absolute";
    clone.style.top = `${offset}px`;
    clone.style.left = "0";
    clone.style.width = `${rect.width}px`;
    clone.style.margin = "0";
    wrapper.appendChild(clone);
    offset += rect.height;
  }
  wrapper.style.height = `${offset}px`;

  host.appendChild(wrapper);
  return { el: wrapper, originX: event.clientX, originY: event.clientY };
}

/** Translates the overlay by the pointer's total delta since drag start,
 * rather than re-deriving a `top`/`left` from the overlay's own (already
 * transformed) `getBoundingClientRect()` each tick - the same
 * self-referential-feedback-loop trap `lib/dnd/useSortableList.ts`'s own
 * top doc comment calls out for the identical reason. */
function moveDragOverlay(overlay: DragOverlay, event: PointerEvent): void {
  const dx = event.clientX - overlay.originX;
  const dy = event.clientY - overlay.originY;
  overlay.el.style.transform = `translate(${dx}px, ${dy}px)`;
}

/** Removes the overlay, returning its last on-screen rect for
 * `playDropSettle` to invert from. */
function removeDragOverlay(overlay: DragOverlay): DOMRect {
  const rect = overlay.el.getBoundingClientRect();
  overlay.el.remove();
  return rect;
}

/** The FLIP "drop settle" half of the same technique
 * `lib/dnd/useSortableList.ts` already uses (see its own `endDrag`): the
 * newly-placed block(s) render at a brand new DOM position the instant
 * `commitReorderMove` dispatches, with no transition of their own - this
 * inverts each one from the floating overlay's last rect into a transform,
 * then eases that back to identity over one frame, so the handoff from
 * "floating card" to "settled in its new spot" reads as one continuous
 * motion rather than the card vanishing and content just appearing
 * elsewhere. Matched up with the overlay's own stacking order (also
 * ascending doc position, see `buildDragOverlay`) by walking `state.doc` in
 * order and testing reference identity against `nodes` - ProseMirror
 * `Node`s are immutable value objects, so `buildReorderTransaction` reusing
 * the very same reference when it deletes-then-reinserts one is what makes
 * that identity check valid; it survives being nested inside a fresh
 * wrapper too (`wrapForTarget`'s `list_item`, `insertDraggedNodes`'s
 * `grid_item`), since `descendants` still visits it as a child either way. */
function playDropSettle(view: EditorView, nodes: PMNode[], overlayRect: DOMRect): void {
  const settled: HTMLElement[] = [];
  view.state.doc.descendants((node, pos) => {
    if (nodes.includes(node)) {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) settled.push(dom);
    }
    return true;
  });
  if (settled.length === 0) return;

  let offset = 0;
  for (const dom of settled) {
    const rect = dom.getBoundingClientRect();
    const deltaX = overlayRect.left - rect.left;
    const deltaY = overlayRect.top + offset - rect.top;
    dom.style.transition = "none";
    dom.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    dom.style.boxShadow = "var(--dry-shadow-lg)";
    requestAnimationFrame(() => {
      dom.style.transition = `transform ${DROP_SETTLE_MS}ms ${DROP_SETTLE_EASING}, box-shadow ${DROP_SETTLE_MS}ms ease`;
      dom.style.transform = "";
      dom.style.boxShadow = "";
      setTimeout(() => {
        dom.style.transition = "";
      }, DROP_SETTLE_MS);
    });
    offset += rect.height;
  }
}

function startReorderDrag(view: EditorView, positions: number[], mode: ReorderModeValue, event: PointerEvent): void {
  const win = view.dom.ownerDocument.defaultView ?? window;
  const height = draggedHeight(view, positions);
  const overlay = buildDragOverlay(view, positions, event);
  view.dispatch(view.state.tr.setMeta(reorderModeKey, { setDragging: { positions, target: null, height } }));

  const move = (moveEvent: PointerEvent) => {
    moveDragOverlay(overlay, moveEvent);
    const pluginState = reorderModeKey.getState(view.state);
    if (!pluginState?.dragging) return;
    const nextTarget = computeDropTarget(view, positions, moveEvent, mode);
    if (!dropTargetsEqual(nextTarget, pluginState.dragging.target)) {
      const tr = view.state.tr.setMeta(reorderModeKey, { setDragging: { positions, target: nextTarget, height } });
      view.updateState(view.state.apply(tr));
    }
  };
  const finish = (upEvent: PointerEvent) => {
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", finish);
    moveDragOverlay(overlay, upEvent);
    const pluginState = reorderModeKey.getState(view.state);
    const target = pluginState?.dragging?.target ?? computeDropTarget(view, positions, upEvent, mode);
    const overlayRect = removeDragOverlay(overlay);
    if (target) commitReorderMove(view, positions, target, overlayRect);
    else view.dispatch(view.state.tr.setMeta(reorderModeKey, { setDragging: null }));
  };
  win.addEventListener("pointermove", move);
  win.addEventListener("pointerup", finish);
}

/** `handleDOMEvents.pointerdown` - no block (container or not) has a drag
 * handle of its own; the whole block acts as one, so a pointerdown anywhere
 * inside it (as long as it doesn't land on a *nested* block's own area
 * first - `closest` naturally finds the innermost `.dry-tx-reorder-block`
 * match, i.e. a child block rather than the container around it) starts the
 * drag, or - on Cmd/Ctrl+click - toggles it into/out of the multi-selection
 * instead. `isDraggableNode` gates both: the trailing landing-spot paragraph
 * is hidden entirely (`isTrailingEmptyParagraph`, in `buildDecorations`) so
 * it's never actually reachable here, and under `"nested-container"` mode a
 * non-container block is left alone (no `preventDefault`, no selection/drag
 * start) so normal browser behavior - i.e. nothing, `editable` is already
 * `false` - applies to it instead. */
function onBlockPointerDown(view: EditorView, event: PointerEvent): boolean {
  const pluginState = reorderModeKey.getState(view.state);
  if (!pluginState?.active) return false;
  const blockEl = (event.target as Element | null)?.closest(".dry-tx-reorder-block");
  if (!blockEl) return false;
  const pos = posBeforeElement(view, blockEl);
  if (pos == null) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isDraggableNode(view.state.doc, pos, node, pluginState.mode)) return false;
  event.preventDefault();
  // `editable` is false in reorder mode, so nothing about a click natively
  // focuses `view.dom` the way it would in a normal contenteditable - and
  // without DOM focus somewhere inside it, a later Delete/Backspace keydown
  // has nowhere of ours to bubble through (see `handleKeyDown` below, and
  // `useRichTextEditor.ts`'s conditional `tabindex` that makes this
  // actually focusable while reorder mode is active). Deferred one tick
  // rather than called inline here - focusing `view.dom` synchronously,
  // mid-pointerdown, races ProseMirror's own native "this click landed on a
  // block node" handling and lets IT win, leaving a plain
  // `ProseMirror-selectednode` `NodeSelection` behind instead of running
  // the `setMeta`/`setSelected` dispatch below at all.
  const win = view.dom.ownerDocument.defaultView ?? window;
  win.setTimeout(() => view.dom.focus({ preventScroll: true }), 0);

  if (event.metaKey || event.ctrlKey) {
    const selected = pluginState.selected.includes(pos)
      ? pluginState.selected.filter((p) => p !== pos)
      : [...pluginState.selected, pos].sort((a, b) => a - b);
    view.dispatch(view.state.tr.setMeta(reorderModeKey, { setSelected: selected }));
    return true;
  }

  const positions = pluginState.selected.includes(pos) && pluginState.selected.length > 1 ? pluginState.selected : [pos];
  if (positions.length === 1 && (pluginState.selected.length !== 1 || pluginState.selected[0] !== pos)) {
    view.dispatch(view.state.tr.setMeta(reorderModeKey, { setSelected: positions }));
  }
  startReorderDrag(view, positions, pluginState.mode, event);
  return true;
}

export function reorderMode(): Plugin<ReorderState> {
  return new Plugin<ReorderState>({
    key: reorderModeKey,
    state: {
      init: () => EMPTY_STATE,
      apply(tr, prev) {
        const meta = tr.getMeta(reorderModeKey);
        if (meta) {
          if ("toggle" in meta)
            return meta.toggle ? { active: true, mode: "block", selected: [], dragging: null } : EMPTY_STATE;
          // Not `if`/`else if` - `commitReorderMove` sets BOTH `setSelected`
          // and `setDragging` on the same meta object (clearing the
          // selection and the just-finished drag together), and both need
          // to actually apply rather than the first key checked winning and
          // returning early, silently dropping the other.
          let next = prev;
          if ("setSelected" in meta) next = { ...next, selected: meta.setSelected as number[] };
          if ("setDragging" in meta) next = { ...next, dragging: meta.setDragging as ReorderDragging | null };
          // Switching modes drops any selection/in-flight drag - a block
          // valid to drag/target under the old mode may not be under the
          // new one (e.g. a plain paragraph selected in "block" mode is
          // frozen the instant "nested-container" is picked).
          if ("setMode" in meta)
            next = { ...next, mode: meta.setMode as ReorderModeValue, selected: [], dragging: null };
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
      handleDOMEvents: {
        pointerdown: onBlockPointerDown,
        // A plain `handleDOMEvents` entry (raw DOM listener wiring, same as
        // `pointerdown` above), not the specialized `handleKeyDown` prop -
        // that one runs through ProseMirror's own internal keydown handler,
        // which turned out to swallow the event entirely while `editable`
        // is `false` (confirmed empirically: a debug log inside it never
        // fired, even though the raw DOM `keydown` event itself demonstrably
        // reached `view.dom`). `handleDOMEvents` entries don't go through
        // that internal path, so they fire regardless of `editable`, same
        // as `pointerdown` already relies on throughout this file.
        keydown(view, event) {
          if (event.key !== "Delete" && event.key !== "Backspace") return false;
          const handled = deleteSelectedBlocks()(view.state, view.dispatch);
          if (handled) event.preventDefault();
          return handled;
        },
      },
    },
  });
}
