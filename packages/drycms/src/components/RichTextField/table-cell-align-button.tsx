import type { RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import Popover from "../Popover.js";
import { CellAlignIcon } from "./cell-align-icon.js";
import { runCommand } from "./commands.js";
import { getCellAlignState, setCellAlign } from "./table.js";
import type { CellHAlign, CellVAlign } from "./schema.js";
import type { ToolbarIconSize } from "./types.js";

const V_ALIGNS: CellVAlign[] = ["top", "middle", "bottom"];
const H_ALIGNS: CellHAlign[] = ["left", "center", "right"];

export interface TableCellAlignButtonProps {
  viewRef: RefObject<EditorView | null>;
  disabled?: boolean;
  iconSize: ToolbarIconSize;
}

/**
 * Cell alignment picker docked in `table-menu.tsx`'s controls row - a 3x3
 * grid (`vAlign` rows x `hAlign` columns) reusing `table-insert-button.tsx`'s
 * own seamless-cell grid classes (`.richtext-table-grid*`) rather than
 * duplicating that CSS, just a fixed 3x3 with a single active cell instead of
 * a variable hover-highlighted range. Applies to every cell in a multi-cell
 * `CellSelection` at once, not just wherever the cursor happens to sit - see
 * `setCellAlign`'s own doc comment in `table.ts`. Left open after a click
 * (unlike `TableInsertButton`'s one-shot close) so trying a few combinations
 * in a row doesn't mean reopening the popover each time - same idiom as
 * `ColorMenu`'s swatches.
 */
export default function TableCellAlignButton({ viewRef, disabled = false, iconSize }: TableCellAlignButtonProps) {
  const view = viewRef.current;
  const { hAlign, vAlign, mixed, disabled: noCell } = view
    ? getCellAlignState(view.state)
    : { hAlign: "left" as const, vAlign: "middle" as const, mixed: false, disabled: true };
  const isDisabled = disabled || noCell;

  const apply = (h: CellHAlign, v: CellVAlign) => {
    if (!view) return;
    runCommand(view, setCellAlign(h, v));
  };

  return (
    <Popover
      label="Cell alignment"
      tooltip="Cell alignment"
      trigger={(onClick) => (
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Cell alignment"
          data-tooltip="Cell alignment"
          aria-haspopup="dialog"
          disabled={isDisabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
        >
          <CellAlignIcon />
        </button>
      )}
    >
      <li role="none" class="richtext-table-grid-picker">
        <div class="richtext-table-grid" role="group" aria-label="Cell alignment">
          {V_ALIGNS.map((v) => (
            <div class="richtext-table-grid-row" key={v}>
              {H_ALIGNS.map((h) => (
                <button
                  type="button"
                  key={h}
                  class={`richtext-table-grid-cell${!mixed && h === hAlign && v === vAlign ? " active" : ""}`}
                  aria-label={`${v}, ${h}`}
                  aria-pressed={!mixed && h === hAlign && v === vAlign}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => apply(h, v)}
                />
              ))}
            </div>
          ))}
        </div>
      </li>
    </Popover>
  );
}
