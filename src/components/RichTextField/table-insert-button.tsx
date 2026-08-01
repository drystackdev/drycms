import { useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import Popover from "../Popover.js";
import { TableIcon } from "../icons.js";
import { runCommand } from "./commands.js";
import { insertTable } from "./table.js";
import type { ToolbarIconSize } from "./types.js";
import { displayShortcut } from "./shortcuts.js";

const GRID_SIZE = 6;
const GRID_INDICES = Array.from({ length: GRID_SIZE }, (_, i) => i);

export interface TableInsertButtonProps {
  viewRef: RefObject<EditorView | null>;
  disabled?: boolean;
  iconSize: ToolbarIconSize;
}

/** The always-visible trigger inside `table-menu.tsx`'s own docked card -
 * unlike every other insert button (`image-insert-button.tsx`), this one
 * isn't part of `toolbar-buttons.ts`'s generic registry: it lives fixed at
 * the start of that card, ahead of the contextual row/column/etc controls
 * that only expand once a table's actually selected, matching that same
 * card's own border/background/shadow rather than sitting bare among the
 * toolbar's other always-there buttons. Its own narrow prop type (not the
 * shared `ToolbarCustomProps`) reflects that: it's only ever called
 * directly from `table-menu.tsx` now, never through that generic registry,
 * so it only takes what it actually uses. A 6x6 grid picker (matching
 * Word/Docs/Notion's own "insert table" UX) rather than an instant-
 * fixed-size insert: hovering highlights the rows/columns up to the
 * hovered cell and shows a live "rows x cols" label; clicking calls
 * `insertTable(rows, cols)` (`table.ts`) at that size. Anchored top-right
 * rather than top-left: the fixed corner is the grid's top-right cell, so
 * hovering it selects a single 1x1 and dragging toward the bottom-left
 * grows the selection - row highlighting still grows downward from the
 * top, but column highlighting grows leftward from the right edge
 * (`col >= hoverCol`, not `col <= hoverCol`), and the picked column count
 * counts inward from that same right edge (`GRID_SIZE - hoverCol`, not
 * `hoverCol + 1`). Unlike every other custom-children `Popover` in this
 * field (which leave the popover open after a click - e.g. `ColorMenu`'s
 * swatches, meant to be tried more than once), picking a table size is a
 * one-shot action, so this stashes the trigger's own toggle callback
 * (`closeOnPick`) to close the popover right after inserting.
 */
export default function TableInsertButton({ viewRef, disabled = false, iconSize }: TableInsertButtonProps) {
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
            data-tooltip={`Insert table (${displayShortcut("Ctrl/Cmd+Alt+T")})`}
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
                  class={`richtext-table-grid-cell${row <= hoverRow && col >= hoverCol ? " active" : ""}`}
                  aria-label={`${row + 1} x ${GRID_SIZE - col}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setHoverRow(row);
                    setHoverCol(col);
                  }}
                  onClick={(event) => insert(row + 1, GRID_SIZE - col, event)}
                />
              ))}
            </div>
          ))}
        </div>
        <div class="richtext-table-grid-label">{hoverRow >= 0 ? `${hoverRow + 1} x ${GRID_SIZE - hoverCol}` : "Insert table"}</div>
      </li>
    </Popover>
  );
}
