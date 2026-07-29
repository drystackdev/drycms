import type { MarkType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { blockNodeTypeAndAttrs, blockTypeOfNode, schema } from "./schema.js";
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
