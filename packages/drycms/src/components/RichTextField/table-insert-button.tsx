import { useRef, useState } from "preact/hooks";
import Popover from "../Popover.js";
import { TableIcon } from "../icons.js";
import { runCommand } from "./commands.js";
import { insertTable } from "./table.js";
import type { ToolbarCustomProps } from "./types.js";

const GRID_SIZE = 10;
const GRID_INDICES = Array.from({ length: GRID_SIZE }, (_, i) => i);

/** Toolbar button inserting a table at the selection - a 10x10 grid picker
 * (matching Word/Docs/Notion's own "insert table" UX) rather than this
 * button's old instant-fixed-size insert: hovering highlights the rows/
 * columns up to the hovered cell and shows a live "rows x cols" label;
 * clicking calls `insertTable(rows, cols)` (`table.ts`) at that size.
 * Unlike every other custom-children `Popover` in this field (which leave
 * the popover open after a click - e.g. `ColorMenu`'s swatches, meant to be
 * tried more than once), picking a table size is a one-shot action, so this
 * stashes the trigger's own toggle callback (`closeOnPick`) to close the
 * popover right after inserting.
 */
export default function TableInsertButton({ viewRef, disabled = false, iconSize }: ToolbarCustomProps) {
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const closeOnPick = useRef<(event: MouseEvent) => void>(() => {});

  const insert = (rows: number, cols: number, event: MouseEvent) => {
    const view = viewRef.current;
    if (view) runCommand(view, insertTable(rows, cols));
    closeOnPick.current(event);
  };

  const resetHover = () => {
    setHoverRow(-1);
    setHoverCol(-1);
  };

  return (
    <Popover
      label="Insert table"
      tooltip="Insert table"
      trigger={(onClick) => {
        closeOnPick.current = onClick;
        return (
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Insert table"
            data-tooltip="Insert table"
            aria-haspopup="dialog"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              resetHover();
              onClick(event);
            }}
          >
            <TableIcon />
          </button>
        );
      }}
    >
      <li role="none" class="richtext-table-grid-picker">
        <div class="richtext-table-grid" role="group" aria-label="Table size" onMouseLeave={resetHover}>
          {GRID_INDICES.map((row) => (
            <div class="richtext-table-grid-row" key={row}>
              {GRID_INDICES.map((col) => (
                <button
                  type="button"
                  key={col}
                  class={`richtext-table-grid-cell${row <= hoverRow && col <= hoverCol ? " active" : ""}`}
                  aria-label={`${row + 1} x ${col + 1}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setHoverRow(row);
                    setHoverCol(col);
                  }}
                  onClick={(event) => insert(row + 1, col + 1, event)}
                />
              ))}
            </div>
          ))}
        </div>
        <div class="richtext-table-grid-label">{hoverRow >= 0 ? `${hoverRow + 1} x ${hoverCol + 1}` : "Insert table"}</div>
      </li>
    </Popover>
  );
}
