import type { EditorView } from "prosemirror-view";
import type { RefObject } from "preact";
import type { FileManagerSource } from "../file-manager-types.js";

export type InlineFormat = "bold" | "italic" | "underline";

/** The 4 alignments this field's menu offers - Lexical's own
 * `ElementFormatType` also has `'start' | 'end' | ''`, which this field
 * never sets and folds back to `"left"` for display (see readAlign in
 * `useRichTextEditor.ts`). */
export type TextAlign = "left" | "center" | "right" | "justify";

/** The block-level element a top-level selection currently sits in -
 * `"paragraph"` is the default `<p>`; `"h2"`-`"h6"` and `"quote"` are the
 * other blocks `./schema.ts` defines nodes for. */
export type BlockType = "paragraph" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote";

export interface ActiveFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export const NO_FORMAT: ActiveFormat = { bold: false, italic: false, underline: false };

/** Everything a toolbar button's `isActive`/`isDisabled` predicate can read -
 * add a field here (and populate it from `useRichTextEditor`) when a new
 * button needs to react to something beyond these. */
export interface ToolbarState {
  format: ActiveFormat;
  align: TextAlign;
  /** CSS `color` value currently applied to the selection - `""` when unset
   * or mixed across the selection (see `$getSelectionStyleValueForProperty`
   * in `useRichTextEditor.ts`). */
  color: string;
  blockType: BlockType;
  /** Whether "Clear format" has anything to do - unlike `format` above
   * (which reads `false` for a bit that's only *partially* applied across
   * the selection, since `RangeSelection.hasFormat` requires uniformity),
   * this is `true` as soon as ANY selected text carries a format or color,
   * so a selection mixing (e.g.) bold-only and bold+italic runs still
   * enables the button. */
  clearable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Whether the selection has any actual text in it - `false` for e.g. a
   * `NodeSelection` around the image node, which can't carry inline marks
   * at all. Disables bold/italic/underline rather than leaving them
   * clickable no-ops. */
  inlineEditable: boolean;
}

/** Props every non-toggle toolbar item (`AlignMenu`, `ColorMenu`, `BlockTypeMenu`, ...)
 * receives - unlike a `ToolbarButton` these render their own trigger/popover
 * instead of a single button `toolbar.tsx` can render generically, so they
 * need the full live state plus what it takes to run editor commands. Lives
 * here rather than `toolbar-buttons.ts` so that file can import the menu
 * components without a cycle (they only need this type back). */
/** Matches the `sm`/`md`/`lg`/`xl` scale every other icon-only button in
 * drycms uses (see `class="ghost icon <size>"` throughout the app). */
export type ToolbarIconSize = "sm" | "md" | "lg" | "xl";

export interface ToolbarCustomProps {
  viewRef: RefObject<EditorView | null>;
  contentRef: RefObject<HTMLElement>;
  state: ToolbarState;
  disabled?: boolean;
  /** Where the "Insert image" button's picker dialog reads its files from -
   * only that item reads this; every other custom item ignores it. Absent
   * entirely hides that button (see `requiresSource` in `toolbar-buttons.ts`). */
  source?: FileManagerSource;
  /** Applied to this item's own trigger button (`class="ghost icon
   * <iconSize>"`), same as every plain `ToolbarButton` - `toolbar.tsx`
   * always resolves and passes this down, so custom items never need their
   * own default. */
  iconSize: ToolbarIconSize;
}

/** Shared by `useRichTextEditor.ts` (reading `ElementNode.getFormatType()`)
 * and `html.ts` (reading a parsed `text-align` style value) - anything else
 * (Lexical's `'start'`/`'end'`/`''`, or garbage from hand-written HTML)
 * folds back to the default. */
export function normalizeTextAlign(value: string | null | undefined): TextAlign {
  return value === "center" || value === "right" || value === "justify" ? value : "left";
}
