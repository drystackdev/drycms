import type { MarkType, Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { Command, EditorState } from "prosemirror-state";
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
 * very menu the button lives on. */
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
      dispatch(tr);
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
