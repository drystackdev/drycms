import type { MarkType, Node as PMNode, ResolvedPos } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { blockNodeTypeAndAttrs, blockTypeOfNode, schema, type ImageAlign, type ImageObjectFit } from "./schema.js";
import type { BlockType, TextAlign } from "./types.js";

/**
 * Editor commands - ported (mostly verbatim) from drystack's
 * `form/fields/markdoc/editor/Toolbar.tsx` and `commands/misc.ts`, which are
 * plain `prosemirror-state` `Command` functions with no React in them. Only
 * `setTextColor`/`getTextColorState` drop drystack's "cursor resting inside
 * a colored run without a selection" niceity (`markAround`) - this field's
 * previous Lexical-based `ColorMenu` never had that either, so this isn't a
 * regression.
 */

export function runCommand(view: EditorView, command: Command) {
  command(view.state, view.dispatch, view);
  view.focus();
}

export function isMarkActive(markType: MarkType) {
  return (state: EditorState): boolean => {
    const { from, to, empty } = state.selection;
    if (empty) {
      return !!markType.isInSet(state.storedMarks || state.selection.$from.marks());
    }
    // A range with no text at all (e.g. a `NodeSelection` around the image
    // node) must report "not active", not the loop's untouched initial
    // value - otherwise a selected image shows every mark button as active,
    // since nothing in the range ever sets `active` to `false`.
    let active = true;
    let sawText = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      sawText = true;
      if (!markType.isInSet(node.marks)) active = false;
    });
    return sawText && active;
  };
}

/** Whether the selection has any actual text in it (a collapsed cursor
 * counts too - toggling a mark there just seeds `storedMarks` for the next
 * typed character). `false` for e.g. a `NodeSelection` around the image
 * node, which can't carry inline marks at all - used to disable the
 * bold/italic/underline buttons rather than leave them clickable no-ops. */
export function hasInlineContent(state: EditorState): boolean {
  const { from, to, empty } = state.selection;
  if (empty) return true;
  let sawText = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) sawText = true;
  });
  return sawText;
}

/** Whether the selection currently spans an actual range - unlike
 * `hasInlineContent` above, a collapsed cursor does NOT count here. Used to
 * disable the text-color button specifically: unlike bold/italic/underline
 * (toggling those with nothing selected usefully seeds `storedMarks` for the
 * next typed character), applying a color with nothing highlighted has
 * nothing to visibly color and would read as broken. */
export function hasTextSelection(state: EditorState): boolean {
  return !state.selection.empty;
}

/** Mirrors the old `ToolbarState.clearable`: true as soon as ANY selected
 * text carries a mark (bold/italic/underline/textColor - the only marks
 * this schema has), not just one that's uniformly applied. */
export function isClearable(state: EditorState): boolean {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  let clearable = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.length > 0) clearable = true;
  });
  return clearable;
}

export function removeAllMarks(): Command {
  return (state, dispatch) => {
    if (state.selection.empty) return false;
    if (dispatch) dispatch(state.tr.removeMark(state.selection.from, state.selection.to));
    return true;
  };
}

export function getTextColorState(state: EditorState): { value: string; disabled: boolean } {
  const { from, to, empty } = state.selection;
  if (empty) return { value: "", disabled: true };
  let value: string | undefined;
  let mixed = false;
  let sawText = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    sawText = true;
    const mark = schema.marks.textColor!.isInSet(node.marks);
    const v = (mark?.attrs.value as string | undefined) ?? "";
    if (value === undefined) value = v;
    else if (value !== v) mixed = true;
  });
  // No text in range (e.g. a `NodeSelection` around the image) - same as
  // `empty` above, there's nothing a color mark could apply to.
  if (!sawText) return { value: "", disabled: true };
  return { value: mixed ? "" : (value ?? ""), disabled: false };
}

export function setTextColor(value: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    if (dispatch) {
      let tr = state.tr.removeMark(from, to, schema.marks.textColor!);
      if (value) tr = tr.addMark(from, to, schema.marks.textColor!.create({ value }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Extends a collapsed cursor resting inside (or at either edge of) a `link`
 * run to the full contiguous range it covers - a mark only knows "is this
 * text node in the set", not "where does this specific run start/end", so
 * finding the boundaries means walking outward from the cursor's own text
 * node. Same technique every ProseMirror-based link feature uses (e.g.
 * Tiptap's `Link` extension); needed because `link` is `inclusive: false`
 * (see schema.ts), so a plain `$pos.marks()` read goes empty right at the
 * run's own edges - exactly where a user's cursor often lands after clicking
 * into one. Returns `null` when `$pos` isn't actually sitting inside a link. */
function linkMarkRange($pos: ResolvedPos): { from: number; to: number } | null {
  const linkType = schema.marks.link!;
  const parent = $pos.parent;
  const offset = $pos.parentOffset;
  // `childAfter` favors the run to the right of the cursor at a boundary
  // between two runs; `childBefore` is only consulted as a fallback (cursor
  // at the very end of `parent`, or right after a link with nothing linked
  // following it).
  let anchor = parent.childAfter(offset);
  if (!anchor.node || !linkType.isInSet(anchor.node.marks)) anchor = parent.childBefore(offset);
  if (!anchor.node || !linkType.isInSet(anchor.node.marks)) return null;

  const anchorStart = $pos.start() + anchor.offset;
  let startIndex = anchor.index;
  let startPos = anchorStart;
  while (startIndex > 0 && linkType.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
    startPos -= parent.child(startIndex).nodeSize;
  }

  let endIndex = anchor.index + 1;
  let endPos = anchorStart + anchor.node.nodeSize;
  while (endIndex < parent.childCount && linkType.isInSet(parent.child(endIndex).marks)) {
    endPos += parent.child(endIndex).nodeSize;
    endIndex += 1;
  }
  return { from: startPos, to: endPos };
}

export interface LinkState {
  href: string;
  target: string | null;
  /** Whether the selection/cursor is currently sitting on a single existing
   * link - drives `link-menu.tsx`'s switch between "create" (a plain
   * URL-only popover) and "edit" (a fuller dialog with the `target`
   * toggle) rendering. */
  active: boolean;
  /** Nothing to act on: no selection, and the cursor isn't resting inside an
   * existing link either. Mirrors `getTextColorState`'s own `disabled`, but
   * a link additionally stays enabled on a *collapsed* cursor (via
   * `linkMarkRange` above) so editing one never requires re-selecting it. */
  disabled: boolean;
}

export function getLinkState(state: EditorState): LinkState {
  const linkType = schema.marks.link!;
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const range = linkMarkRange($from);
    if (!range) return { href: "", target: null, active: false, disabled: true };
    const node = state.doc.nodeAt(range.from);
    const mark = node && linkType.isInSet(node.marks);
    if (!mark) return { href: "", target: null, active: false, disabled: true };
    return { href: mark.attrs.href as string, target: (mark.attrs.target as string | null) ?? null, active: true, disabled: false };
  }
  let href: string | undefined;
  let target: string | null | undefined;
  let mixed = false;
  let sawText = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    sawText = true;
    const mark = linkType.isInSet(node.marks);
    const v = (mark?.attrs.href as string | undefined) ?? "";
    if (href === undefined) href = v;
    else if (href !== v) mixed = true;
    target = (mark?.attrs.target as string | null | undefined) ?? null;
  });
  if (!sawText) return { href: "", target: null, active: false, disabled: true };
  const resolvedHref = mixed ? "" : (href ?? "");
  return { href: resolvedHref, target: mixed ? null : (target ?? null), active: !mixed && !!resolvedHref, disabled: false };
}

/** Sets (or updates) the `link` mark's `href`/`target` over the selection -
 * or, for a collapsed cursor, over whatever `linkMarkRange` finds it resting
 * inside. Returns `false` (a no-op) for a collapsed cursor that isn't inside
 * an existing link - creating a brand new link always needs a real selection
 * to attach it to, same requirement `getLinkState`'s own `disabled` enforces
 * for the toolbar button. */
export function setLink(href: string, target: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty, $from } = state.selection;
    const range = empty ? linkMarkRange($from) : { from, to };
    if (!range) return false;
    if (dispatch) {
      const tr = state.tr
        .removeMark(range.from, range.to, schema.marks.link!)
        .addMark(range.from, range.to, schema.marks.link!.create({ href, target }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function removeLink(): Command {
  return (state, dispatch) => {
    const { from, to, empty, $from } = state.selection;
    const range = empty ? linkMarkRange($from) : { from, to };
    if (!range) return false;
    if (dispatch) dispatch(state.tr.removeMark(range.from, range.to, schema.marks.link!));
    return true;
  };
}

function nodeSupportsTextAlign(node: { type: { spec: { attrs?: Record<string, unknown> } } }): boolean {
  const attrs = node.type.spec.attrs;
  return !!attrs && "textAlign" in attrs;
}

/** Sets the `textAlign` attr on every alignable block (paragraph, heading,
 * blockquote) overlapping the selection - `null` clears it (the "left"
 * default). */
export function setTextAlign(align: TextAlign | null): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    let tr = state.tr;
    let applied = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (nodeSupportsTextAlign(node)) {
        applied = true;
        if (dispatch) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: align });
      }
    });
    if (!applied) return false;
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

export function getTextAlignState(state: EditorState): { isDisabled: boolean; selected: TextAlign } {
  const { from, to } = state.selection;
  let align: string | null | undefined;
  let found = false;
  let mixed = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (nodeSupportsTextAlign(node)) {
      found = true;
      const nodeAlign = (node.attrs.textAlign as string | null) ?? null;
      if (align === undefined) align = nodeAlign;
      else if (align !== nodeAlign) mixed = true;
    }
  });
  if (!found || mixed) return { isDisabled: !found, selected: "left" };
  return { isDisabled: false, selected: (align ?? "left") as TextAlign };
}

export function getBlockType(state: EditorState): BlockType {
  return blockTypeOfNode(state.selection.$from.parent);
}

/** paragraph/heading/blockquote are all flat textblocks in this schema
 * (content `"inline*"`, same shape as the old Lexical `ElementNode`
 * subclasses), so converting between them is just swapping each touched
 * top-level block's type/attrs via `setNodeMarkup` - no wrap/lift needed.
 * Not `prosemirror-commands`' own `setBlockType`: that applies one static
 * `attrs` object to every match, which would drop each block's existing
 * `textAlign` instead of carrying it over. */
export function setBlockTypeCommand(target: BlockType): Command {
  const { type, attrs } = blockNodeTypeAndAttrs(target);
  return (state, dispatch) => {
    const { from, to } = state.selection;
    let tr = state.tr;
    let applied = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return;
      applied = true;
      if (dispatch) {
        tr = tr.setNodeMarkup(pos, type, { ...attrs, textAlign: node.attrs.textAlign ?? null }, node.marks);
      }
    });
    if (!applied) return false;
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

export function insertHardBreak(): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break!.create()).scrollIntoView());
    return true;
  };
}

/** Drives `image-menu.tsx`'s visibility/anchor - `null` unless the selection
 * is exactly a `NodeSelection` around an image node. */
export function getSelectedImage(state: EditorState): { pos: number; node: PMNode } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type === schema.nodes.image) {
    return { pos: selection.from, node: selection.node };
  }
  return null;
}

/** Toggles one of the 3 float/center layouts on the image at `pos` - the
 * caller (`image-menu.tsx`) passes `null` itself to turn the active one back
 * off, same one-of-four-but-toggleable shape as `setTextAlign` above. */
export function setImageAlign(pos: number, align: ImageAlign | null): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type !== schema.nodes.image) return false;
    if (dispatch) dispatch(state.tr.setNodeAttribute(pos, "align", align));
    return true;
  };
}

/** Pulls the image at `pos` out into a lone `paragraph` of its own, mirroring
 * `html.ts`'s own `<figure>` (block-level, own line) vs. bare `<img>`
 * (inline, shares its paragraph) split - called by `setImageAttrs` below the
 * moment a caption goes from empty to non-empty, since a captioned image is
 * HTML-standard only as a `<figure>` sibling, never inline text. No-ops (past
 * re-anchoring the selection) if the image already has its paragraph to
 * itself. Splits the surrounding textblock around the image when it has
 * running text on *both* sides, so neither half of that text is lost -
 * `paragraph, before-text, paragraph(image), after-text` (or just the one
 * split half if the image was flush against an edge). Position tracking goes
 * through `tr.mapping` throughout since inserts/splits shift everything
 * after them. */
function extractImageBlock(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (!node) return tr;
  const $pos = tr.doc.resolve(pos);
  if ($pos.parent.childCount === 1) return tr.setSelection(NodeSelection.create(tr.doc, pos));

  const blockStart = $pos.before();
  const blockEnd = $pos.after();
  const imgEnd = pos + node.nodeSize;
  const hadContentBefore = pos > $pos.start();
  const hadContentAfter = imgEnd < $pos.end();
  const wrapper = schema.nodes.paragraph!.create(null, node.type.create(node.attrs, null, node.marks));

  tr = tr.delete(pos, imgEnd);
  const boundary = tr.mapping.map(pos);

  let insertPos: number;
  if (!hadContentBefore) {
    insertPos = tr.mapping.map(blockStart);
  } else if (!hadContentAfter) {
    insertPos = tr.mapping.map(blockEnd);
  } else {
    // `boundary` is already a post-delete position, not one from `tr`'s
    // starting doc - mapping it through the split step alone (not the
    // cumulative `tr.mapping`, which starts from before the delete) avoids
    // applying the delete's own shift to it a second time. `assoc: -1` lands
    // on the end of the first split-off block's own content (right before
    // its closing tag) rather than the start of the second's - `+ 1` then
    // steps past that closing tag onto the sibling gap between the two
    // blocks, which is where the image's new paragraph belongs.
    const stepsBeforeSplit = tr.mapping.maps.length;
    tr = tr.split(boundary);
    insertPos = tr.mapping.slice(stepsBeforeSplit).map(boundary, -1) + 1;
  }
  tr = tr.insert(insertPos, wrapper);
  return tr.setSelection(NodeSelection.create(tr.doc, insertPos + 1));
}

/** The inverse of `extractImageBlock` above - folds the image at `pos` back
 * into whichever adjacent textblock is closest ("nearest possible" per this
 * feature's own spec), called the moment a caption goes from non-empty back
 * to empty. Only fires when the image is still alone in its own block (an
 * already-shared paragraph has nothing to collapse); prefers the previous
 * sibling so the image reads as trailing content, falling back to the next
 * sibling only when there's no textblock before it; leaves the image in its
 * solo paragraph untouched if neither neighbor can take inline content (e.g.
 * a table or grid) rather than forcing an invalid merge. */
function collapseImageBlock(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (!node) return tr;
  const $pos = tr.doc.resolve(pos);
  if ($pos.parent.childCount !== 1) return tr.setSelection(NodeSelection.create(tr.doc, pos));

  const blockStart = $pos.before();
  const blockEnd = $pos.after();
  const before = tr.doc.resolve(blockStart).nodeBefore;
  const after = tr.doc.resolve(blockEnd).nodeAfter;
  const target = before?.isTextblock ? "before" : after?.isTextblock ? "after" : null;
  if (!target) return tr.setSelection(NodeSelection.create(tr.doc, pos));

  const bareImage = node.type.create(node.attrs, null, node.marks);
  tr = tr.delete(blockStart, blockEnd);
  const insertPos = target === "before" ? tr.mapping.map(blockStart) - 1 : tr.mapping.map(blockStart) + 1;
  tr = tr.insert(insertPos, bareImage);
  return tr.setSelection(NodeSelection.create(tr.doc, insertPos));
}

/** Patches any combination of the image at `pos`'s own editable attrs in one
 * transaction - shared by `image-menu.tsx`'s standalone lock-aspect-ratio
 * toggle (just `lockAspectRatio`, plus a recomputed `height` when it turns
 * on) and its edit dialog's Save button (`alt`/`width`/`height`/
 * `lockAspectRatio` together, so the whole edit is one undo step). One
 * `setNodeAttribute` per key rather than a single `setNodeMarkup` - like
 * `setImageAlign` above, not `replaceImageSrc` below: `setNodeMarkup` on a
 * leaf/atom node (this schema's `image`) replaces the node outright, which
 * drops the `NodeSelection` the floating menu itself depends on - so
 * toggling the lock or saving the edit dialog would immediately close the
 * very menu the button lives on.
 *
 * A `caption` key in `patch` also runs `extractImageBlock`/
 * `collapseImageBlock` on an empty<->non-empty transition, in the same
 * transaction/undo step as the attr patch itself - see those two for why. */
export function setImageAttrs(
  pos: number,
  patch: Partial<{
    alt: string;
    width: number | null;
    height: number | null;
    objectFit: ImageObjectFit;
    caption: string;
    lockAspectRatio: boolean;
  }>,
): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type !== schema.nodes.image) return false;
    if (dispatch) {
      let tr = state.tr;
      for (const [key, value] of Object.entries(patch)) tr = tr.setNodeAttribute(pos, key, value);
      if ("caption" in patch) {
        const hadCaption = !!(node.attrs.caption as string);
        const hasCaption = !!patch.caption;
        if (!hadCaption && hasCaption) tr = extractImageBlock(tr, pos);
        else if (hadCaption && !hasCaption) tr = collapseImageBlock(tr, pos);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Swaps the image at `pos` for a different file picked from the library -
 * `align` carries over (still the same spot in the document's layout) but
 * `width`/`height` reset: the old size was fit to the previous image's own
 * aspect ratio, and keeping it would squash/stretch a differently-shaped
 * replacement rather than just showing it at its own natural size. */
export function replaceImageSrc(pos: number, src: string, alt: string): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type !== schema.nodes.image) return false;
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src, alt, width: null, height: null });
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    }
    return true;
  };
}

/** Deletes whatever node sits at `pos` - used by `image-menu.tsx`'s "Remove
 * image" button, but not itself image-specific. */
export function removeNodeAt(pos: number, nodeSize: number): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.delete(pos, pos + nodeSize));
    return true;
  };
}
