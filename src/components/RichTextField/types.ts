import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { RefObject } from "preact";
import type { FileManagerSource } from "../../storage/entry-types.js";
import type { ListType } from "./lists.js";

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
  /** Whether the selection spans an actual range rather than sitting
   * collapsed - see `hasTextSelection` in `commands.ts`. Only `ColorMenu`
   * reads this (disabling the text-color button when nothing's highlighted);
   * every other inline-format button stays usable on a collapsed cursor via
   * `inlineEditable` above. */
  hasSelection: boolean;
  /** The image node currently selected as a whole (a `NodeSelection` sitting
   * on it), if any - drives the floating per-image menu (`image-menu.tsx`),
   * same way `align`/`blockType` above drive their own toolbar items. `null`
   * whenever the selection isn't exactly an image (including a `NodeSelection`
   * on some other node - there are none yet, but this stays accurate if one's
   * ever added). */
  selectedImage: { pos: number; node: PMNode } | null;
  /** Which list (if any) the selection's top-level block currently sits
   * directly inside - drives `list-menu.tsx`'s trigger icon (see
   * `getListType` in `lists.ts`). */
  listType: ListType;
  /** The table containing the selection, if any - drives `table-menu.tsx`'s
   * visibility/anchor (see `getSelectedTable` in `table.ts`). Unlike
   * `selectedImage`, this isn't a `NodeSelection` check: the cursor normally
   * sits *inside* one of the table's cells, not on the table node itself. */
  selectedTable: { pos: number; node: PMNode } | null;
  /** The grid containing the selection, if any - drives `grid-menu.tsx`'s
   * visibility/anchor (see `getSelectedGrid` in `grid.ts`). Same "walk
   * ancestors" shape as `selectedTable` above, not a `NodeSelection` check. */
  selectedGrid: { pos: number; node: PMNode } | null;
  /** The `link` mark on the current selection/cursor - see `getLinkState` in
   * `commands.ts` for what each field means and why a *collapsed* cursor can
   * still report one (unlike `color`/`format` above, which need a real
   * selection). Drives `link-menu.tsx`'s create-vs-edit rendering. */
  link: { href: string; target: string | null; active: boolean; disabled: boolean };
  /** Whether "reorder mode" (`reorder-mode.ts`) is currently on - drives its
   * own toolbar toggle's pressed state and, in `toolbar.tsx`, disables every
   * other control while it's active. */
  reorderModeActive: boolean;
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
  /** Human-readable keyboard shortcut shown in the item's tooltip. */
  shortcut?: string;
  /** Whether `RichTextField` is currently expanded fullscreen, and the
   * toggle for it - only `fullscreen-button.tsx` reads either, same
   * optionality as `source`/`ImageInsertButton` above. */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

/** Shared by `useRichTextEditor.ts` (reading `ElementNode.getFormatType()`)
 * and `html.ts` (reading a parsed `text-align` style value) - anything else
 * (Lexical's `'start'`/`'end'`/`''`, or garbage from hand-written HTML)
 * folds back to the default. */
export function normalizeTextAlign(value: string | null | undefined): TextAlign {
  return value === "center" || value === "right" || value === "justify" ? value : "left";
}
