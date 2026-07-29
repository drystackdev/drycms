import { FullscreenExitIcon, FullscreenIcon } from "../icons.js";
import type { ToolbarCustomProps } from "./types.js";

/** Toggles `RichTextField` between its normal inline size and filling the
 * viewport (see the `.richtext-fullscreen` class in forms.css, and the
 * state/Escape-key handling in `RichTextField.tsx`, which owns both since
 * neither is ProseMirror editor state - unlike every other toolbar item,
 * this one doesn't touch `viewRef` at all. */
export default function FullscreenButton({ fullscreen = false, onToggleFullscreen, disabled = false, iconSize }: ToolbarCustomProps) {
  if (!onToggleFullscreen) return <></>;
  return (
    <button
      type="button"
      class={`ghost icon ${iconSize}`}
      aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      data-tooltip={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      aria-pressed={fullscreen}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggleFullscreen}
    >
      {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
    </button>
  );
}
