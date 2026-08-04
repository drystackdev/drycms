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
import DryComponentInsertButton from "./dry-component-insert-button.js";
import FullscreenButton from "./fullscreen-button.js";
import ImageInsertButton from "./image-insert-button.js";
import LinkMenu from "./link-menu.js";
import ListMenu from "./list-menu.js";
import { removeAllMarks } from "./commands.js";
import { schema } from "./schema.js";
import type { InlineFormat, ToolbarCustomProps, ToolbarState } from "./types.js";
import { temporaryFeatureVisibility } from "../../features/temporary-visibility.js";

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
  shortcut?: string;
  /** Same meaning as `ToolbarCustomItem.blockOnly` below - only "insert
   * grid" needs this on a plain button so far, every other `ToolbarButton`
   * (undo/redo, bold/italic/underline, clear format) is equally valid in a
   * single-inline-run field. */
  blockOnly?: boolean;
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
  /** Same meaning as `ToolbarButton.isDisabled` - `toolbar.tsx` ORs this into
   * the `disabled` prop it already passes every custom item. */
  isDisabled?: (state: ToolbarState) => boolean;
  shortcut?: string;
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
    shortcut: key === "bold" ? "Ctrl/Cmd+B" : key === "italic" ? "Ctrl/Cmd+I" : "Ctrl/Cmd+U",
    isActive: (state: ToolbarState) => state.format[key],
    isDisabled: (state: ToolbarState) => !state.inlineEditable,
  })),
  {
    type: "button",
    key: "clear-format",
    label: "Clear format",
    Icon: ClearFormatIcon,
    run: removeAllMarks(),
    shortcut: "Ctrl+Space",
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
  // Inline group: every item here formats a text run (a mark) at "the
  // current spot in the text" rather than a whole top-level element, unlike
  // the block/feature groups below.
  [
    ...INLINE_FORMAT_BUTTONS,
    { type: "custom", key: "color", Component: ColorMenu, shortcut: "Ctrl/Cmd+Alt+C" },
    { type: "custom", key: "link", Component: LinkMenu, shortcut: "Ctrl/Cmd+K" },
  ],
  // Block group: every item here acts on a whole top-level element
  // (paragraph/heading/quote node, or its alignment) rather than a run of
  // text - all flagged `blockOnly` so `inline` mode hides them together.
  // Also all disabled while an image is selected: `state.doc.nodesBetween`
  // still visits the image's *enclosing* paragraph even for a NodeSelection
  // that spans only the image (it's `inline: true`, so it can only ever live
  // inside a textblock) - without this, "Turn into"/"Align text"/"List"
  // would silently retarget that paragraph (turn it into a heading, wrap it
  // in a list...) while the toolbar looks like it's acting on the image.
  [
    { type: "custom", key: "block-type", Component: BlockTypeMenu, blockOnly: true, shortcut: "Ctrl/Cmd+Shift+N", isDisabled: (state) => !!state.selectedImage },
    { type: "custom", key: "align", Component: AlignMenu, blockOnly: true, shortcut: "Ctrl/Cmd+L/E/R/J", isDisabled: (state) => !!state.selectedImage },
    { type: "custom", key: "list", Component: ListMenu, blockOnly: true, shortcut: "Ctrl/Cmd+Shift+L / Ctrl/Cmd+.", isDisabled: (state) => !!state.selectedImage },
  ],
  // Feature group: insert a whole standalone block rather than formatting
  // text. The custom RichText component entry point is temporarily hidden;
  // its implementation and persisted content remain supported underneath.
  [
    { type: "custom", key: "insert-image", Component: ImageInsertButton, blockOnly: true, requiresSource: true, shortcut: "Ctrl/Cmd+Alt+M" },
    ...(temporaryFeatureVisibility.richtextComponentInsert
      ? [{ type: "custom" as const, key: "insert-component", Component: DryComponentInsertButton, blockOnly: true }]
      : []),
  ],
  // View group: fullscreen changes how the whole field is presented rather
  // than formatting its content. Reorder remains implemented in the editor,
  // but its toolbar control is temporarily hidden.
  [
    { type: "custom", key: "fullscreen", Component: FullscreenButton, blockOnly: true, shortcut: "Ctrl/Cmd+Shift+F" },
  ],
  // "Insert grid" itself isn't here - it sits next to "Insert table" in
  // `TableMenu`'s own always-present card instead (`table-menu.tsx`), not
  // through this generic registry. See that file's own doc comment.
];
