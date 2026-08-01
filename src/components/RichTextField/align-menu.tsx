import type { JSX } from "preact";
import { runCommand, setTextAlign } from "./commands.js";
import Popover from "../Popover.js";
import { AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon, type IconProps } from "../icons.js";
import type { TextAlign, ToolbarCustomProps } from "./types.js";

const ALIGN_OPTIONS: { value: TextAlign; label: string; Icon: (props: IconProps) => JSX.Element }[] = [
  { value: "left", label: "Left", Icon: AlignLeftIcon },
  { value: "center", label: "Center", Icon: AlignCenterIcon },
  { value: "right", label: "Right", Icon: AlignRightIcon },
  { value: "justify", label: "Justify", Icon: AlignJustifyIcon },
];

/**
 * A popover instead of a plain toggle button - alignment is one-of-four, not
 * a bit that flips on/off, and the trigger shows whichever option is
 * currently active (see `current` below) rather than a fixed icon.
 */
export default function AlignMenu({ viewRef, state, disabled = false, iconSize, shortcut }: ToolbarCustomProps) {
  const current = ALIGN_OPTIONS.find((option) => option.value === state.align) ?? ALIGN_OPTIONS[0]!;

  const applyAlign = (value: TextAlign) => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, setTextAlign(value));
  };

  return (
    <Popover
      label={shortcut ? `Align text (${shortcut})` : "Align text"}
      items={ALIGN_OPTIONS.map((option) => ({
        type: "item" as const,
        label: option.label,
        icon: <option.Icon />,
        checked: option.value === current.value,
        onClick: () => applyAlign(option.value),
      }))}
      trigger={(onClick) => (
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Align text"
          data-tooltip={`Align: ${current.label}${shortcut ? ` (${shortcut})` : ""}`}
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
