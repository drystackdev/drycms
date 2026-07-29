import { GridIcon } from "../icons.js";
import type { ToolbarCustomProps } from "./types.js";

/** Toggles the grid feature's editing affordances (the outline around
 * `section` and each top-level block's column-span resize handle - see
 * `grid-column-resize.ts` and the `.dry-tx-grid-mode` rules in
 * `content-shadow-styles.ts`) on and off. Every block already carries its own
 * `colSpan` regardless of this toggle - turning it off just hides the UI for
 * changing it, same "state lives one level up, this button just flips it"
 * shape as `fullscreen-button.tsx`, except this one also has to reach
 * ProseMirror (see the `gridMode` effect in `useRichTextEditor.ts`), unlike
 * fullscreen which is pure CSS. */
export default function GridModeButton({ gridMode = false, onToggleGridMode, disabled = false, iconSize }: ToolbarCustomProps) {
  if (!onToggleGridMode) return <></>;
  return (
    <button
      type="button"
      class={`ghost icon ${iconSize}`}
      aria-label={gridMode ? "Exit grid layout" : "Grid layout"}
      data-tooltip={gridMode ? "Exit grid layout" : "Grid layout"}
      aria-pressed={gridMode}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggleGridMode}
    >
      <GridIcon />
    </button>
  );
}
