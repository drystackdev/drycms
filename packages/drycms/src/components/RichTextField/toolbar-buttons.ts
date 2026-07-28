import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";
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
import type { InlineFormat, ToolbarState } from "./types.js";

/**
 * The toolbar's button registry - `toolbar.tsx` only knows how to render
 * whatever's in `TOOLBAR_GROUPS` (one `<hr>` gap per group), so adding or
 * removing a formatting feature is just editing the list below.
 */
export interface ToolbarButton {
  key: string;
  label: string;
  Icon: (props: IconProps) => JSX.Element;
  /** Runs inside the button's onClick, after focus/selection have been
   * restored to the editor - just dispatch a command or call `editor.update`. */
  run: (editor: LexicalEditor) => void;
  isActive?: (state: ToolbarState) => boolean;
  isDisabled?: (state: ToolbarState) => boolean;
}

function clearFormat(editor: LexicalEditor) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    (["bold", "italic", "underline"] as const).forEach((type) => {
      if (selection.hasFormat(type)) selection.formatText(type);
    });
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
    key,
    label,
    Icon,
    run: (editor: LexicalEditor) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, key),
    isActive: (state: ToolbarState) => state.format[key],
  })),
  {
    key: "clear-format",
    label: "Clear format",
    Icon: ClearFormatIcon,
    run: clearFormat,
    isDisabled: (state: ToolbarState) => !(state.format.bold || state.format.italic || state.format.underline),
  },
];

export const TOOLBAR_GROUPS: ToolbarButton[][] = [
  [
    {
      key: "undo",
      label: "Undo",
      Icon: UndoIcon,
      run: (editor) => editor.dispatchCommand(UNDO_COMMAND, undefined),
      isDisabled: (state) => !state.canUndo,
    },
    {
      key: "redo",
      label: "Redo",
      Icon: RedoIcon,
      run: (editor) => editor.dispatchCommand(REDO_COMMAND, undefined),
      isDisabled: (state) => !state.canRedo,
    },
  ],
  INLINE_FORMAT_BUTTONS,
];
