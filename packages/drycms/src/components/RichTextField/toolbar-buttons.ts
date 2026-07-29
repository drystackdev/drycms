import { toggleMark } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import type { Command } from "prosemirror-state";
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
import FullscreenButton from "./fullscreen-button.js";
import ImageInsertButton from "./image-insert-button.js";
import ListMenu from "./list-menu.js";
import { removeAllMarks } from "./commands.js";
import { schema } from "./schema.js";
import type { InlineFormat, ToolbarCustomProps, ToolbarState } from "./types.js";

/**
 * The toolbar's item registry - `toolbar.tsx` only knows how to render
 * whatever's in `TOOLBAR_GROUPS` (one bordered `.richtext-toolbar-block` per
 * group, not an `<hr>` gap), so adding or removing a formatting feature is
 * just editing the list below. Most items are a `ToolbarButton` (a single
 * toggle/action button); `AlignMenu`, `BlockTypeMenu` and `ColorMenu` are
 * `ToolbarCustomItem`s instead - each renders its own trigger/popover
 * because "one of several options" or "a whole color grid" doesn't fit a
 * single button's on/off `isActive`.
 */
export interface ToolbarButton {
  type: "button";
  key: string;
  label: string;
  Icon: (props: IconProps) => JSX.Element;
  /** A plain `prosemirror-state` `Command` - `toolbar.tsx` runs it via
   * `commands.ts`'s `runCommand`, which also restores focus to the editor. */
  run: Command;
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

// Only the true toggles go through this generic transform - each shares the
// same `run`/`isActive` shape, keyed off `state.format[key]`. "Clear format"
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
    run: toggleMark(schema.marks[key]!),
    isActive: (state: ToolbarState) => state.format[key],
    isDisabled: (state: ToolbarState) => !state.inlineEditable,
  })),
  {
    type: "button",
    key: "clear-format",
    label: "Clear format",
    Icon: ClearFormatIcon,
    run: removeAllMarks(),
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
      run: undo,
      isDisabled: (state) => !state.canUndo,
    },
    {
      type: "button",
      key: "redo",
      label: "Redo",
      Icon: RedoIcon,
      run: redo,
      isDisabled: (state) => !state.canRedo,
    },
  ],
  // Inline group: every item here either formats a text run (a mark) or
  // inserts an image inline with one - kept together since both operate at
  // "the current spot in the text" rather than a whole top-level element,
  // unlike the block group below. `insert-image` still carries its own
  // `blockOnly` (an image insertion doesn't belong in a single-run `inline`
  // field either), so it still drops out on its own under `inline` mode
  // rather than needing this whole group flagged.
  [
    ...INLINE_FORMAT_BUTTONS,
    { type: "custom", key: "color", Component: ColorMenu },
    { type: "custom", key: "insert-image", Component: ImageInsertButton, blockOnly: true, requiresSource: true },
  ],
  // Block group: every item here acts on a whole top-level element
  // (paragraph/heading/quote node, or its alignment) rather than a run of
  // text - all flagged `blockOnly` so `inline` mode hides them together.
  // Fullscreen joins this group too: expanding the whole field to fill the
  // viewport is a page-layout concern, not text formatting, but it's no
  // more useful in a single-inline-run field (a title, say) than the
  // block-type/align/list menus it now sits alongside.
  [
    { type: "custom", key: "block-type", Component: BlockTypeMenu, blockOnly: true },
    { type: "custom", key: "align", Component: AlignMenu, blockOnly: true },
    { type: "custom", key: "list", Component: ListMenu, blockOnly: true },
    { type: "custom", key: "fullscreen", Component: FullscreenButton, blockOnly: true },
  ],
];
