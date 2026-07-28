import {
  $getSelection,
  $isRangeSelection,
  $setTextFormat,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import { $patchStyleText } from "@lexical/selection";
import type { JSX } from "preact";
import {
  BoldIcon,
  ClearFormatIcon,
  ItalicIcon,
  RedoIcon,
  UnderlineIcon,
  UndoIcon,
  type IconProps,
} from "../icons.js";
import AlignMenu from "./align-menu.js";
import BlockTypeMenu from "./block-menu.js";
import ColorMenu from "./color-menu.js";
import ImageInsertButton from "./image-insert-button.js";
import type { InlineFormat, ToolbarCustomProps, ToolbarState } from "./types.js";

/**
 * The toolbar's item registry - `toolbar.tsx` only knows how to render
 * whatever's in `TOOLBAR_GROUPS` (one `<hr>` gap per group), so adding or
 * removing a formatting feature is just editing the list below. Most items
 * are a `ToolbarButton` (a single toggle/action button); `AlignMenu`,
 * `BlockTypeMenu` and `ColorMenu` are `ToolbarCustomItem`s instead - each
 * renders its own trigger/popover because "one of several options" or "a
 * whole color grid" doesn't fit a single button's on/off `isActive`.
 */
export interface ToolbarButton {
  type: "button";
  key: string;
  label: string;
  Icon: (props: IconProps) => JSX.Element;
  /** Runs inside the button's onClick, after focus/selection have been
   * restored to the editor - just dispatch a command or call `editor.update`. */
  run: (editor: LexicalEditor) => void;
  isActive?: (state: ToolbarState) => boolean;
  isDisabled?: (state: ToolbarState) => boolean;
}

export interface ToolbarCustomItem {
  type: "custom";
  key: string;
  Component: (props: ToolbarCustomProps) => JSX.Element;
  /** Operates on a whole block element (`BlockTypeMenu`, `AlignMenu`) rather
   * than an inline text run - hidden by `toolbar.tsx` when `RichTextField`'s
   * `inline` prop is set, unlike `ColorMenu` (a `<span style="color:...">`
   * is inline, same as bold/italic/underline). */
  blockOnly?: boolean;
  /** Needs `ToolbarCustomProps.source` to do anything (`ImageInsertButton`) -
   * hidden by `toolbar.tsx` when `RichTextField` gets no `source` prop. */
  requiresSource?: boolean;
}

export type ToolbarItem = ToolbarButton | ToolbarCustomItem;

function clearFormat(editor: LexicalEditor) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    // `$setTextFormat` (unlike `FORMAT_TEXT_COMMAND`'s `selection.formatText`,
    // a *toggle*) sets each bit to an exact value - so a selection mixing
    // e.g. a bold-only run with a bold+italic run still comes out fully
    // unformatted. A toggle-based approach would get this backwards for a
    // mixed/nested selection: since it isn't uniformly "on" for the
    // not-yet-cleared format, a single `formatText` call would turn that
    // format ON everywhere instead of off.
    $setTextFormat(selection, { bold: false, italic: false, underline: false });
    $patchStyleText(selection, { color: null });
  });
}

// Only the true toggles go through this generic transform - each shares the
// same `run`/`isActive` shape, keyed off `state.format[key]`. `clearFormat`
// below has its own `run`/`isDisabled` and must NOT be folded into this
// `.map()` (it did briefly - `state.format["clear-format"]` isn't a real
// format bit, so `isActive` was always undefined and its real `isDisabled`
// got silently overwritten by this map's output, which doesn't set one).
const INLINE_TOGGLES: { key: InlineFormat; label: string; Icon: ToolbarButton["Icon"] }[] = [
  { key: "bold", label: "Bold", Icon: BoldIcon },
  { key: "italic", label: "Italic", Icon: ItalicIcon },
  { key: "underline", label: "Underline", Icon: UnderlineIcon },
];

const INLINE_FORMAT_BUTTONS: ToolbarButton[] = [
  ...INLINE_TOGGLES.map(({ key, label, Icon }) => ({
    type: "button" as const,
    key,
    label,
    Icon,
    run: (editor: LexicalEditor) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, key),
    isActive: (state: ToolbarState) => state.format[key],
  })),
  {
    type: "button",
    key: "clear-format",
    label: "Clear format",
    Icon: ClearFormatIcon,
    run: clearFormat,
    isDisabled: (state: ToolbarState) => !state.clearable,
  },
];

export const TOOLBAR_GROUPS: ToolbarItem[][] = [
  [
    {
      type: "button",
      key: "undo",
      label: "Undo",
      Icon: UndoIcon,
      run: (editor) => editor.dispatchCommand(UNDO_COMMAND, undefined),
      isDisabled: (state) => !state.canUndo,
    },
    {
      type: "button",
      key: "redo",
      label: "Redo",
      Icon: RedoIcon,
      run: (editor) => editor.dispatchCommand(REDO_COMMAND, undefined),
      isDisabled: (state) => !state.canRedo,
    },
  ],
  // Inline group: every item here formats a text run (a Lexical format bit
  // or a `<span style="color:...">`) - kept together, and separate from the
  // block group below, so `inline` mode (see `toolbar.tsx`) can drop the
  // latter as one unit.
  [...INLINE_FORMAT_BUTTONS, { type: "custom", key: "color", Component: ColorMenu }],
  // Block group: every item here acts on a whole top-level element
  // (paragraph/heading/quote node, or its alignment) rather than a run of
  // text - both flagged `blockOnly` so `inline` mode hides them together.
  [
    { type: "custom", key: "block-type", Component: BlockTypeMenu, blockOnly: true },
    { type: "custom", key: "align", Component: AlignMenu, blockOnly: true },
    { type: "custom", key: "insert-image", Component: ImageInsertButton, blockOnly: true, requiresSource: true },
  ],
];
