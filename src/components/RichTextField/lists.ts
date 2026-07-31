import { Fragment, NodeRange, Slice, type Attrs, type NodeType } from "prosemirror-model";
import { liftListItem } from "prosemirror-schema-list";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { ReplaceAroundStep, canSplit, findWrapping } from "prosemirror-transform";
import { schema } from "./schema.js";

/**
 * `prosemirror-schema-list` exports the pieces this needs (`liftListItem`,
 * plus `findWrapping`/`ReplaceAroundStep`/`canSplit` from
 * `prosemirror-transform`) but not a "toggle in/out of/between list types"
 * convenience command itself - `toggleList` below is ported from that
 * package's own (unexported) internal helper of the same name, dropping only
 * the case that never applies to this field's own toolbar (`attrs` is always
 * `null` here - `list-menu.tsx` never sets `ordered_list.start`).
 */

export type ListType = "none" | "bullet" | "ordered";

/** Which list (if any) the selection's top-level block currently sits
 * directly inside - drives `list-menu.tsx`'s trigger icon and its "click the
 * active option again to lift out" toggle, mirrors `getBlockType` in
 * `commands.ts` for the two list node types. */
export function getListType(state: EditorState): ListType {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === schema.nodes.bullet_list) return "bullet";
    if (node.type === schema.nodes.ordered_list) return "ordered";
  }
  return "none";
}

function findParentList(range: NodeRange, listItemType: NodeType) {
  for (let d = range.depth; d > 0; d--) {
    const parent = range.$from.node(d);
    if (parent.type.contentMatch.defaultType === listItemType) {
      return { node: parent, pos: range.$from.before(d) };
    }
  }
  return undefined;
}

function doWrapInList(
  tr: Transaction,
  range: NodeRange,
  wrappers: { type: NodeType; attrs?: Attrs | null }[],
  joinBefore: boolean,
  listType: NodeType,
) {
  let content = Fragment.empty;
  for (let i = wrappers.length - 1; i >= 0; i--) {
    content = Fragment.from(wrappers[i]!.type.create(wrappers[i]!.attrs, content));
  }
  tr.step(
    new ReplaceAroundStep(
      range.start - (joinBefore ? 2 : 0),
      range.end,
      range.start,
      range.end,
      new Slice(content, 0, 0),
      wrappers.length,
      true,
    ),
  );

  let found = 0;
  for (let i = 0; i < wrappers.length; i++) {
    if (wrappers[i]!.type === listType) found = i + 1;
  }
  const splitDepth = wrappers.length - found;

  let splitPos = range.start + wrappers.length - (joinBefore ? 2 : 0);
  const parent = range.parent;
  for (let i = range.startIndex, e = range.endIndex, first = true; i < e; i++, first = false) {
    if (!first && canSplit(tr.doc, splitPos, splitDepth)) {
      tr.split(splitPos, splitDepth);
      splitPos += 2 * splitDepth;
    }
    splitPos += parent.child(i).nodeSize;
  }
  return tr;
}

/** Wraps the selection in a list of `listType`, already-in-that-exact-list
 * lifts back out to plain paragraphs, already-in-the-*other*-list-type
 * converts it in place (one `setNodeMarkup`, no re-wrap/re-lift round trip) -
 * the "click the currently active option again" and "switch bullet <-> ordered"
 * behaviors `list-menu.tsx` needs from a single command. */
export function toggleList(listType: NodeType): Command {
  const listItemType = listType.contentMatch.defaultType!;
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let range = $from.blockRange($to);
    let outerRange = range;
    if (!range) return false;

    const parentList = findParentList(range, listItemType);
    if (parentList?.node.type === listType) {
      return liftListItem(listItemType)(state, dispatch);
    }
    if (parentList && parentList.node.type !== listType) {
      if (dispatch) dispatch(state.tr.setNodeMarkup(parentList.pos, listType, null).scrollIntoView());
      return true;
    }

    let doJoin = false;
    if (range.depth >= 2 && $from.node(range.depth - 1).type.compatibleContent(listType) && range.startIndex === 0) {
      if ($from.index(range.depth - 1) === 0) return false;
      const $insert = state.doc.resolve(range.start - 2);
      outerRange = new NodeRange($insert, $insert, range.depth);
      if (range.endIndex < range.parent.childCount) {
        range = new NodeRange($from, state.doc.resolve($to.end(range.depth)), range.depth);
      }
      doJoin = true;
    }
    const wrap = findWrapping(outerRange!, listType, null, range);
    if (!wrap) return false;
    if (dispatch) dispatch(doWrapInList(state.tr, range, wrap, doJoin, listType).scrollIntoView());
    return true;
  };
}
