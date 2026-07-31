import { useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import Popover from "../Popover.js";
import { EyeClosedIcon, EyeIcon, TrashIcon } from "../icons.js";
import { runCommand } from "./commands.js";
import { removeGrid, setGridColumns } from "./grid.js";
import { isHighlightLineOn, setHighlightLine } from "./grid-resize.js";
import { GRID_COLUMN_OPTIONS } from "./schema.js";
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
 * always-present "insert" half here - that button lives inside
 * `table-menu.tsx`'s own permanent card instead, right next to "Insert
 * table" (its own doc comment explains why), so this card is purely
 * contextual). Contains
 * 3 actions: a columns picker (a `Popover` listing `GRID_COLUMN_OPTIONS`,
 * same one-of-many pattern as `align-menu.tsx` - picking a value calls
 * `setGridColumns` in `grid.ts`, which also rescales every item's `colSpan`
 * proportionally so the layout stays roughly the same shape rather than
 * items suddenly occupying a very different fraction of the row), the
 * `highlightLine` toggle (dashed borders + the 2 per-item resize handles -
 * see `grid-resize.ts`/`grid-item-view.ts`), and "Xoá grid" (unwrap -
 * `removeGrid` in `grid.ts`).
 *
 * This card itself still collapses when the selection leaves the grid (same
 * as `TableMenu`) - but `highlightLine` is anchored to the grid's own doc
 * position in `grid-resize.ts`, not to live selection, so the dashed-border/
 * handle chrome in the content area stays visible after that happens. Only
 * clicking back into the grid (or its own "Xoá grid") changes it again.
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

  const highlightOn = view && selected ? isHighlightLineOn(view.state, selected.pos) : false;
  const columns = (selected?.node.attrs.columns as number | undefined) ?? GRID_COLUMN_OPTIONS[0];

  return (
    <div class={`richtext-grid-menu-controls-wrap${controlsShown ? " expanded" : ""}`} aria-hidden={!expanded}>
      <div class="richtext-grid-menu-controls">
        <Popover
          label="Grid columns"
          items={GRID_COLUMN_OPTIONS.map((value) => ({
            type: "item" as const,
            label: String(value),
            checked: value === columns,
            onClick: () => {
              if (!selected || !view) return;
              runCommand(view, setGridColumns(selected.pos, selected.node, value));
            },
          }))}
          trigger={(onClick) => (
            <button
              type="button"
              class={`ghost ${iconSize}`}
              aria-label="Grid columns"
              data-tooltip={`Columns: ${columns}`}
              disabled={controlsDisabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClick}
            >
              {columns}
            </button>
          )}
        />
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Toggle highlight lines"
          data-tooltip="Toggle highlight lines"
          aria-pressed={highlightOn}
          disabled={controlsDisabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => view && selected && setHighlightLine(view, selected.pos, !highlightOn)}
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
