import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import { EyeClosedIcon, EyeIcon, TrashIcon } from "../icons.js";
import { runCommand } from "./commands.js";
import { removeGrid } from "./grid.js";
import { isHighlightLineOn, setHighlightLine } from "./grid-resize.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";

export interface GridMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  iconSize?: ToolbarIconSize;
}

/** Kept just above the CSS collapse transition (180ms, see
 * `.richtext-grid-menu-controls-wrap` in components.css) so the card never
 * gets unmounted mid-animation - same idiom `table-menu.tsx`'s
 * `COLLAPSE_DURATION` already uses. */
const COLLAPSE_DURATION = 200;

/**
 * The grid tool-group docked in the main toolbar, mirroring `table-menu.tsx`'s
 * own expand/collapse-on-selection card (unlike that file, there's no
 * always-present "insert" half - `toolbar-buttons.ts`'s plain "Insert grid"
 * button already covers that, so this card is purely contextual). Contains
 * just 2 actions per `status/grid.md`'s own spec: the `highlightLine` toggle
 * (dashed borders + the 2 per-item resize handles - see `grid-resize.ts`/
 * `grid-item-view.ts`) and "Xoá grid" (unwrap - `removeGrid` in `grid.ts`).
 */
export default function GridMenu({ viewRef, state, disabled = false, iconSize = "md" }: GridMenuProps) {
  const selected = state.selectedGrid;
  const view = viewRef.current;
  const expanded = !!selected && !!view;
  const controlsDisabled = disabled || !expanded;

  const [controlsMounted, setControlsMounted] = useState(expanded);
  const [controlsShown, setControlsShown] = useState(expanded);
  useEffect(() => {
    if (expanded) {
      setControlsMounted(true);
      const raf = requestAnimationFrame(() => setControlsShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setControlsShown(false);
    const timeout = setTimeout(() => setControlsMounted(false), COLLAPSE_DURATION);
    return () => clearTimeout(timeout);
  }, [expanded]);

  if (!controlsMounted) return null;

  const highlightOn = view ? isHighlightLineOn(view.state) : false;

  return (
    <div class={`richtext-grid-menu-controls-wrap${controlsShown ? " expanded" : ""}`} aria-hidden={!expanded}>
      <div class="richtext-grid-menu-controls">
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Toggle highlight lines"
          data-tooltip="Toggle highlight lines"
          aria-pressed={highlightOn}
          disabled={controlsDisabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => view && setHighlightLine(view, !highlightOn)}
        >
          {highlightOn ? <EyeIcon /> : <EyeClosedIcon />}
        </button>
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Delete grid"
          data-tooltip="Delete grid"
          disabled={controlsDisabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!selected || !view) return;
            runCommand(view, removeGrid(selected.pos, selected.node));
          }}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
