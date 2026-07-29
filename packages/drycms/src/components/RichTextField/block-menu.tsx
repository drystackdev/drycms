import type { JSX } from "preact";
import { runCommand, setBlockTypeCommand } from "./commands.js";
import Popover from "../Popover.js";
import {
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  Heading5Icon,
  Heading6Icon,
  ParagraphIcon,
  QuoteIcon,
  type IconProps,
} from "../icons.js";
import type { BlockType, ToolbarCustomProps } from "./types.js";

const BLOCK_TYPE_OPTIONS: { value: BlockType; label: string; Icon: (props: IconProps) => JSX.Element }[] = [
  { value: "paragraph", label: "Paragraph", Icon: ParagraphIcon },
  { value: "h2", label: "Heading 2", Icon: Heading2Icon },
  { value: "h3", label: "Heading 3", Icon: Heading3Icon },
  { value: "h4", label: "Heading 4", Icon: Heading4Icon },
  { value: "h5", label: "Heading 5", Icon: Heading5Icon },
  { value: "h6", label: "Heading 6", Icon: Heading6Icon },
  { value: "quote", label: "Quote", Icon: QuoteIcon },
];

/**
 * A popover instead of a plain toggle button - block type is one-of-many,
 * not a bit that flips on/off, and the trigger shows whichever option is
 * currently active (see `current` below) rather than a fixed icon. Mirrors
 * `AlignMenu`.
 */
export default function BlockTypeMenu({ viewRef, state, disabled = false, iconSize }: ToolbarCustomProps) {
  const current = BLOCK_TYPE_OPTIONS.find((option) => option.value === state.blockType) ?? BLOCK_TYPE_OPTIONS[0]!;

  const applyBlockType = (value: BlockType) => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, setBlockTypeCommand(value));
  };

  return (
    <Popover
      label="Turn into"
      items={BLOCK_TYPE_OPTIONS.map((option) => ({
        type: "item" as const,
        label: option.label,
        icon: <option.Icon />,
        onClick: () => applyBlockType(option.value),
      }))}
      trigger={(onClick) => (
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Turn into"
          data-tooltip={`Turn into: ${current.label}`}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
        >
          <current.Icon />
        </button>
      )}
    />
  );
}
