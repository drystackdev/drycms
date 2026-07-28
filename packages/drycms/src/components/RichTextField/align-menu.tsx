import type { JSX, RefObject } from "preact";
import { FORMAT_ELEMENT_COMMAND, type LexicalEditor } from "lexical";
import Popover from "../Popover.js";
import { AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon, type IconProps } from "../icons.js";
import type { TextAlign } from "./types.js";

const ALIGN_OPTIONS: { value: TextAlign; label: string; Icon: (props: IconProps) => JSX.Element }[] = [
  { value: "left", label: "Left", Icon: AlignLeftIcon },
  { value: "center", label: "Center", Icon: AlignCenterIcon },
  { value: "right", label: "Right", Icon: AlignRightIcon },
  { value: "justify", label: "Justify", Icon: AlignJustifyIcon },
];

export interface AlignMenuProps {
  editorRef: RefObject<LexicalEditor | null>;
  contentRef: RefObject<HTMLElement>;
  align: TextAlign;
  disabled?: boolean;
}

/**
 * A popover instead of a plain toggle button - alignment is one-of-four, not
 * a bit that flips on/off, and the trigger shows whichever option is
 * currently active (see `current` below) rather than a fixed icon.
 */
export default function AlignMenu({ editorRef, contentRef, align, disabled = false }: AlignMenuProps) {
  const current = ALIGN_OPTIONS.find((option) => option.value === align) ?? ALIGN_OPTIONS[0]!;

  const applyAlign = (value: TextAlign) => {
    const editor = editorRef.current;
    if (!editor) return;
    contentRef.current?.focus();
    editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, value);
  };

  return (
    <Popover
      label="Align text"
      items={ALIGN_OPTIONS.map((option) => ({
        type: "item" as const,
        label: option.label,
        icon: <option.Icon />,
        onClick: () => applyAlign(option.value),
      }))}
      trigger={(onClick) => (
        <button
          type="button"
          class="ghost icon sm"
          aria-label="Align text"
          data-tooltip={`Align: ${current.label}`}
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
