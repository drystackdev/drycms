import { useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { addRowAfter, addRowBefore, deleteRow, mergeCells, toggleHeaderRow } from "prosemirror-tables";
import FloatingPanel from "../FloatingPanel.js";
import Popover from "../Popover.js";
import TextField from "../TextField.js";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CaptionIcon,
  MergeCellsIcon,
  SplitCellsIcon,
  TableColumnsIcon,
  TableHeaderRowIcon,
  TableRowsIcon,
  TrashIcon,
} from "../icons.js";
import { removeNodeAt, runCommand } from "./commands.js";
import {
  canMergeCells,
  canUnmergeCell,
  insertColumnAfter,
  insertColumnBefore,
  isHeaderRowActive,
  removeSelectedColumns,
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
 * Floating per-table menu, anchored (via `FloatingPanel`, same mechanism as
 * `image-menu.tsx`) to the table's own DOM whenever the selection sits
 * inside one. A flat row of icon buttons - like `ImageMenu` - rather than
 * the single kebab `Popover` this used to be: row/column operations are each
 * a small (2-3 item) `Popover` of their own (auto-flipping via that
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
  const anchor = selected && view ? (view.nodeDOM(selected.pos) as HTMLElement | null) : null;

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

  if (!selected || !view) return null;

  const headerActive = isHeaderRowActive(selected.node);
  const merging = canMergeCells(view.state);
  const unmerging = canUnmergeCell(view.state);

  return (
    <FloatingPanel anchor={anchor}>
      <div class="richtext-table-menu">
        <Popover
          label="Row"
          tooltip="Row"
          items={[
            { type: "item", label: "Insert row above", icon: <ArrowUpIcon />, onClick: () => run(addRowBefore) },
            { type: "item", label: "Insert row below", icon: <ArrowDownIcon />, onClick: () => run(addRowAfter) },
            { type: "item", label: "Delete row", icon: <TrashIcon />, onClick: () => run(deleteRow), danger: true },
          ]}
          trigger={(onClick) => (
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label="Row"
              data-tooltip="Row"
              aria-haspopup="menu"
              disabled={disabled}
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
            { type: "item", label: "Delete column", icon: <TrashIcon />, onClick: () => run(removeSelectedColumns()), danger: true },
          ]}
          trigger={(onClick) => (
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label="Column"
              data-tooltip="Column"
              aria-haspopup="menu"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClick}
            >
              <TableColumnsIcon />
            </button>
          )}
        />
        <hr class="separator" role="separator" aria-orientation="vertical" />
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Toggle header row"
          data-tooltip="Toggle header row"
          aria-pressed={headerActive}
          disabled={disabled}
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
          disabled={disabled || !(merging || unmerging)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run(unmerging ? unmergeCell() : mergeCells)}
        >
          {unmerging ? <SplitCellsIcon /> : <MergeCellsIcon />}
        </button>
        <hr class="separator" role="separator" aria-orientation="vertical" />
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
              aria-pressed={!!(selected.node.attrs.caption as string)}
              disabled={disabled}
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
        <hr class="separator" role="separator" aria-orientation="vertical" />
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Delete table"
          data-tooltip="Delete table"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run(removeNodeAt(selected.pos, selected.node.nodeSize))}
        >
          <TrashIcon />
        </button>
      </div>
    </FloatingPanel>
  );
}
