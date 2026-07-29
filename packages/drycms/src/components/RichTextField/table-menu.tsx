import { useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { addRowAfter, addRowBefore, deleteRow, mergeCells, toggleHeaderRow } from "prosemirror-tables";
import Popover from "../Popover.js";
import TextField from "../TextField.js";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CaptionIcon,
  EraserIcon,
  MergeCellsIcon,
  SplitCellsIcon,
  TableColumnsIcon,
  TableHeaderRowIcon,
  TableRowsIcon,
  TrashIcon,
} from "../icons.js";
import { runCommand } from "./commands.js";
import TableCellAlignButton from "./table-cell-align-button.js";
import TableInsertButton from "./table-insert-button.js";
import {
  canMergeCells,
  canUnmergeCell,
  clearColumnWidths,
  clearRowHeights,
  insertColumnAfter,
  insertColumnBefore,
  isHeaderRowActive,
  removeSelectedColumns,
  removeTable,
  unmergeCell,
} from "./table.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";

export interface TableMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  iconSize?: ToolbarIconSize;
}

/**
 * The table tool-group docked in the main toolbar (rendered by
 * `toolbar.tsx`, right after its own `TOOLBAR_GROUPS`) rather than floating
 * over the table itself - this used to anchor via `FloatingPanel` (same
 * mechanism as `image-menu.tsx`) to the table's own DOM, but that popped a
 * whole separate panel over the content instead of reading as part of the
 * toolbar. Its own card (`.richtext-toolbar-block` - the same bordered/
 * background/shadow look every other toolbar group now uses, components.css)
 * is always visible, `TableInsertButton` docked at its start so there's
 * always a way to insert a table; the row/column/etc
 * controls that only make sense once a table's actually selected live in a
 * second, nested collapsible region (`.richtext-table-menu-controls-wrap`)
 * that expands/collapses via the same `grid-template-columns` transition
 * `.shell`'s sidebar collapse uses, rather than the whole card disappearing -
 * unlike `TableInsertButton`, these always stay mounted (never behind an
 * early `return null`) so that inner region's own expand/collapse can
 * animate, and every one of them disables itself instead when there's no
 * table to act on, both to no-op safely and to drop out of tab order while
 * collapsed. A flat row of icon buttons - like `ImageMenu` - rather than the
 * single kebab `Popover` this used to be: row/column operations are each a
 * small (2-3 item) `Popover` of their own (auto-flipping via that
 * component's own `usePopupFlip`, same as every other multi-option menu in
 * this field), while header/merge/caption/delete are direct single-action
 * buttons, matching `ImageMenu`'s own align/lock/edit/remove row. Merge/
 * split share one contextual button - same icon-and-label-swap idiom as
 * `ImageMenu`'s lock/unlock toggle - rather than two separately-disabled
 * buttons, since exactly one of the two is ever meaningful at a time.
 */
export default function TableMenu({ viewRef, state, disabled = false, iconSize = "md" }: TableMenuProps) {
  // Local draft, applied on demand (see `applyCaption`) rather than
  // dispatched on every keystroke like `ColorMenu`'s swatches - a transaction
  // per keystroke would also refocus the editor (`runCommand` always calls
  // `view.focus()`), stealing focus straight back out of this field's own
  // `TextField` input on every character. Seeded from the live attr whenever
  // the trigger is clicked (see `openCaption`), matching `ImageMenu`'s edit
  // dialog's own draft-then-Save shape.
  const [captionDraft, setCaptionDraft] = useState("");

  const selected = state.selectedTable;
  const view = viewRef.current;
  // Whether there's an actual table to act on - drives both the collapse
  // transition below and every control's own `disabled`, rather than an
  // early `return null` (which would skip mounting entirely and lose the
  // expand/collapse animation on the very first table selection).
  const expanded = !!selected && !!view;
  const controlsDisabled = disabled || !expanded;

  const run = (command: Command) => {
    if (!view) return;
    runCommand(view, command);
  };

  const openCaption = () => {
    if (!selected) return;
    setCaptionDraft((selected.node.attrs.caption as string) ?? "");
  };

  const applyCaption = (caption: string) => {
    if (!selected) return;
    run((editorState, dispatch) => {
      if (dispatch) dispatch(editorState.tr.setNodeAttribute(selected.pos, "caption", caption));
      return true;
    });
  };

  const headerActive = selected ? isHeaderRowActive(selected.node) : false;
  const merging = view ? canMergeCells(view.state) : false;
  const unmerging = view ? canUnmergeCell(view.state) : false;

  return (
    <div class="richtext-table-menu richtext-toolbar-block">
      <TableInsertButton viewRef={viewRef} disabled={disabled} iconSize={iconSize} />
      <div class={`richtext-table-menu-controls-wrap${expanded ? " expanded" : ""}`} aria-hidden={!expanded}>
        <div class="richtext-table-menu-controls">
          <Popover
            label="Row"
            tooltip="Row"
            items={[
              { type: "item", label: "Insert row above", icon: <ArrowUpIcon />, onClick: () => run(addRowBefore) },
              { type: "item", label: "Insert row below", icon: <ArrowDownIcon />, onClick: () => run(addRowAfter) },
              { type: "separator" },
              { type: "item", label: "Clear row height", icon: <EraserIcon />, onClick: () => run(clearRowHeights()) },
              { type: "separator" },
              { type: "item", label: "Delete row", icon: <TrashIcon />, onClick: () => run(deleteRow), danger: true },
            ]}
            trigger={(onClick) => (
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Row"
                data-tooltip="Row"
                aria-haspopup="menu"
                disabled={controlsDisabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onClick}
              >
                <TableRowsIcon />
              </button>
            )}
          />
          <Popover
            label="Column"
            tooltip="Column"
            items={[
              { type: "item", label: "Insert column left", icon: <ArrowLeftIcon />, onClick: () => run(insertColumnBefore()) },
              { type: "item", label: "Insert column right", icon: <ArrowRightIcon />, onClick: () => run(insertColumnAfter()) },
              { type: "separator" },
              { type: "item", label: "Clear column widths", icon: <EraserIcon />, onClick: () => run(clearColumnWidths()) },
              { type: "separator" },
              { type: "item", label: "Delete column", icon: <TrashIcon />, onClick: () => run(removeSelectedColumns()), danger: true },
            ]}
            trigger={(onClick) => (
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Column"
                data-tooltip="Column"
                aria-haspopup="menu"
                disabled={controlsDisabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onClick}
              >
                <TableColumnsIcon />
              </button>
            )}
          />
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Toggle header row"
            data-tooltip="Toggle header row"
            aria-pressed={headerActive}
            disabled={controlsDisabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(toggleHeaderRow)}
          >
            <TableHeaderRowIcon />
          </button>
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label={unmerging ? "Split cell" : "Merge cells"}
            data-tooltip={unmerging ? "Split cell" : "Merge cells"}
            disabled={controlsDisabled || !(merging || unmerging)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(unmerging ? unmergeCell() : mergeCells)}
          >
            {unmerging ? <SplitCellsIcon /> : <MergeCellsIcon />}
          </button>
          <TableCellAlignButton viewRef={viewRef} disabled={controlsDisabled} iconSize={iconSize} />
          <Popover
            label="Caption"
            tooltip="Caption"
            trigger={(onClick) => (
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Caption"
                data-tooltip="Caption"
                aria-haspopup="dialog"
                aria-pressed={!!(selected?.node.attrs.caption as string | undefined)}
                disabled={controlsDisabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  openCaption();
                  onClick(event);
                }}
              >
                <CaptionIcon />
              </button>
            )}
          >
            <li role="none" class="richtext-table-caption-popover">
              <div class="stack">
                <TextField
                  label="Caption"
                  value={captionDraft}
                  onChange={setCaptionDraft}
                  placeholder="e.g. Table 1. Quarterly revenue"
                />
                <div class="row">
                  <button
                    type="button"
                    class="outline"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCaptionDraft("");
                      applyCaption("");
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyCaption(captionDraft)}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </li>
          </Popover>
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Delete table"
            data-tooltip="Delete table"
            disabled={controlsDisabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selected && run(removeTable(selected.pos, selected.node.nodeSize))}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
