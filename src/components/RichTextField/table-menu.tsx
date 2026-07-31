import { useEffect, useState } from "preact/hooks";
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
  GridIcon,
  MergeCellsIcon,
  SplitCellsIcon,
  TableColumnsIcon,
  TableHeaderRowIcon,
  TableRowsIcon,
  TrashIcon,
} from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import { runCommand } from "./commands.js";
import { insertGrid } from "./grid.js";
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

/** Kept just above the CSS collapse transition (180ms, see
 * `.richtext-table-menu-controls-wrap` in components.css) so the card never
 * gets unmounted mid-animation - same idiom as `Toast.tsx`'s `EXIT_DURATION`. */
const COLLAPSE_DURATION = 200;

/**
 * The table tool-group docked in the main toolbar (rendered by
 * `toolbar.tsx`, right after its own `TOOLBAR_GROUPS`) rather than floating
 * over the table itself - this used to anchor via `FloatingPanel` (same
 * mechanism as `image-menu.tsx`) to the table's own DOM, but that popped a
 * whole separate panel over the content instead of reading as part of the
 * toolbar. Renders as *two* independent `.richtext-toolbar-block` cards
 * (a `Fragment`, not one wrapping div) rather than a single card split into
 * zones internally: `TableInsertButton` plus a plain "Insert grid" button
 * share one permanent card (the two live together on purpose - both are
 * "insert a layout block" actions, and `grid-menu.tsx`'s own card has no
 * insert half of its own, only the contextual controls for a grid that's
 * already selected), and the row/column/etc controls (only meaningful once
 * a table's actually selected) in a second card that comes and goes with
 * the selection - `.richtext-toolbar`'s own flex `gap` (components.css)
 * spaces the two apart automatically when both are present, with no dead
 * gap left behind once the second one is gone.
 *
 * That second card doesn't just disappear, though: `controlsMounted`/
 * `controlsShown` below stagger it across two frames on the way in and out,
 * the same enter/exit-then-unmount idiom `Toast.tsx`'s `ToastCard` uses.
 * `controlsShown` drives the `.expanded` class that runs
 * `.richtext-table-menu-controls-wrap`'s `grid-template-columns` collapse
 * (the same 0fr/1fr auto-width transition trick `.shell`'s sidebar collapse
 * uses); `controlsMounted` keeps the card in the DOM for the ~200ms that
 * transition takes before actually unmounting it, so the shrink plays out
 * before the card's own border/padding vanish, rather than the collapsed
 * card lingering as a thin bordered nub indefinitely (which owning its own
 * chrome - now that it isn't nested inside `TableInsertButton`'s shared
 * card - would otherwise leave behind). Every control still disables itself
 * off `expanded` (not `controlsShown`) directly, both to no-op safely and to
 * drop out of tab order the instant the selection leaves a table, even
 * though the card lingers a moment longer visually.
 *
 * A flat row of icon buttons - like `ImageMenu` - rather than the single
 * kebab `Popover` this used to be: row/column operations are each a small
 * (2-3 item) `Popover` of their own (auto-flipping via that component's own
 * `usePopupFlip`, same as every other multi-option menu in this field),
 * while header/merge/caption/delete are direct single-action buttons,
 * matching `ImageMenu`'s own align/lock/edit/remove row. Merge/split share
 * one contextual button - same icon-and-label-swap idiom as `ImageMenu`'s
 * lock/unlock toggle - rather than two separately-disabled buttons, since
 * exactly one of the two is ever meaningful at a time.
 */
export default function TableMenu({ viewRef, state, disabled = false, iconSize = "md" }: TableMenuProps) {
  // Local draft, applied on Save (see `applyCaption`) rather than dispatched
  // on every keystroke like `ColorMenu`'s swatches - a transaction per
  // keystroke would also refocus the editor (`runCommand` always calls
  // `view.focus()`), stealing focus straight back out of this field's own
  // `TextField` input on every character. Seeded from the live attr whenever
  // the trigger is clicked (see `openCaption`), matching `ImageMenu`'s own
  // edit dialog draft-then-Save shape - and, now, its plain `<dialog>`
  // rather than a `Popover`, since a form this shape (label + input +
  // Cancel/Save) reads as a dialog everywhere else in this field.
  const [captionDraft, setCaptionDraft] = useState("");
  const [captionOpen, setCaptionOpen] = useState(false);
  const captionDialogRef = useDialogSync(captionOpen, () => setCaptionOpen(false));

  const selected = state.selectedTable;
  const view = viewRef.current;
  // Whether there's an actual table to act on - drives every control's own
  // `disabled` directly (see the doc comment above for why `controlsShown`,
  // not this, drives the collapse animation).
  const expanded = !!selected && !!view;
  const controlsDisabled = disabled || !expanded;

  // Kept mounted for `COLLAPSE_DURATION` past `expanded` going false so the
  // width collapse below has time to finish before the card - and its own
  // border/padding, now that it's a standalone card rather than a zone
  // inside `TableInsertButton`'s - disappear entirely (see doc comment).
  const [controlsMounted, setControlsMounted] = useState(expanded);
  // Split from `controlsMounted`/`expanded` so a from-unmounted mount always
  // renders one frame at the collapsed (0fr) width before `.expanded` is
  // added - added in the same frame as the mount, there'd be no "before"
  // state for the `grid-template-columns` transition to animate from, same
  // reasoning as `ToastCard`'s own `mounted` flag in `Toast.tsx`.
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

  const run = (command: Command) => {
    if (!view) return;
    runCommand(view, command);
  };

  const openCaption = () => {
    if (!selected) return;
    setCaptionDraft((selected.node.attrs.caption as string) ?? "");
    setCaptionOpen(true);
  };

  const applyCaption = (caption: string) => {
    if (!selected) return;
    run((editorState, dispatch) => {
      if (dispatch) dispatch(editorState.tr.setNodeAttribute(selected.pos, "caption", caption));
      return true;
    });
    setCaptionOpen(false);
  };

  const headerActive = selected ? isHeaderRowActive(selected.node) : false;
  const merging = view ? canMergeCells(view.state) : false;
  const unmerging = view ? canUnmergeCell(view.state) : false;

  return (
    <>
      <div class="richtext-toolbar-block">
        <TableInsertButton viewRef={viewRef} disabled={disabled} iconSize={iconSize} />
        <button
          type="button"
          class={`ghost icon ${iconSize}`}
          aria-label="Insert grid"
          data-tooltip="Insert grid"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => view && runCommand(view, insertGrid())}
        >
          <GridIcon />
        </button>
      </div>
      {controlsMounted && (
        <div class={`richtext-table-menu-controls-wrap${controlsShown ? " expanded" : ""}`} aria-hidden={!expanded}>
          <div class="richtext-table-menu-controls">
            <Popover
              label="Row"
              tooltip="Row"
              items={[
                { type: "item", label: "Insert row above", icon: <ArrowUpIcon />, onClick: () => run(addRowBefore) },
                { type: "item", label: "Insert row below", icon: <ArrowDownIcon />, onClick: () => run(addRowAfter) },
                { type: "separator" },
                { type: "item", label: "Clear size height", icon: <EraserIcon />, onClick: () => run(clearRowHeights()) },
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
                { type: "item", label: "Clear size width", icon: <EraserIcon />, onClick: () => run(clearColumnWidths()) },
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
            <button
              type="button"
              class={`ghost icon ${iconSize}`}
              aria-label="Caption"
              data-tooltip="Caption"
              aria-haspopup="dialog"
              aria-pressed={!!(selected?.node.attrs.caption as string | undefined)}
              disabled={controlsDisabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openCaption}
            >
              <CaptionIcon />
            </button>
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
      )}
      <dialog ref={captionDialogRef} aria-label="Table caption">
        {captionOpen && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyCaption(captionDraft);
            }}
          >
            <header>
              <h3>Table caption</h3>
            </header>
            <TextField
              label="Caption"
              value={captionDraft}
              onChange={setCaptionDraft}
              placeholder="e.g. Table 1. Quarterly revenue"
            />
            <footer>
              <button type="button" class="outline" onClick={() => setCaptionOpen(false)}>
                Cancel
              </button>
              <button type="submit">Save</button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}
