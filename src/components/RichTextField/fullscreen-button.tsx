import { useEffect } from "preact/hooks";
import type { EditorView } from "prosemirror-view";
import { FullscreenExitIcon, FullscreenIcon } from "../icons/index.js";
import type { ToolbarCustomProps } from "./types.js";
import { RICH_TEXT_SHORTCUT_EVENT } from "./shortcuts.js";

/** Toggles `RichTextField` between its normal inline size and filling the
 * viewport (see the `.richtext-fullscreen` class in forms.css, and the
 * state/Escape-key handling in `RichTextField.tsx`, which owns both since
 * neither is ProseMirror editor state - unlike every other toolbar item,
 * this one doesn't touch `viewRef` at all. */
export default function FullscreenButton({ viewRef, fullscreen = false, onToggleFullscreen, disabled = false, iconSize, shortcut }: ToolbarCustomProps) {
  useEffect(() => {
    const onShortcut = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; view?: EditorView }>).detail;
      if (detail?.name !== "fullscreen" || detail.view !== viewRef.current || disabled || !onToggleFullscreen) return;
      onToggleFullscreen();
    };
    document.addEventListener(RICH_TEXT_SHORTCUT_EVENT, onShortcut);
    return () => document.removeEventListener(RICH_TEXT_SHORTCUT_EVENT, onShortcut);
  });
  if (!onToggleFullscreen) return <></>;
  return (
    <button
      type="button"
      class={`ghost icon ${iconSize}`}
      aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      data-tooltip={`${fullscreen ? "Exit fullscreen" : "Fullscreen"}${shortcut ? ` (${shortcut})` : ""}`}
      aria-pressed={fullscreen}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggleFullscreen}
    >
      {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
    </button>
  );
}
