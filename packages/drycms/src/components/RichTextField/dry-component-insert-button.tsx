import { useEffect, useRef, useState } from "preact/hooks";
import { Selection } from "prosemirror-state";
import { components as componentModules } from "virtual:drycms/richtext-components";
import { ComponentIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import { useOverlayScrollbars } from "../overlayscrollbars.js";
import ComponentPreview from "./ComponentPreview.js";
import type { DryComponentRecord } from "./component-registry-types.js";
import { insertBlockAfterFocusedGridItem } from "./grid.js";
import { schema } from "./schema.js";
import type { ToolbarCustomProps } from "./types.js";
import { loadRichtextComponents } from "./useRichTextEditor.js";

/**
 * Toolbar button opening a grid-of-previews picker (same 2-step "select,
 * then Insert" shape as `image-insert-button.tsx`'s `FileManager` dialog) -
 * mục 4 of `status/register-compoennt.md`. Every confirmed record's own
 * `ComponentPreview` loads in parallel with the dialog open, not blocking it.
 */
export default function DryComponentInsertButton({ viewRef, disabled = false, iconSize }: ToolbarCustomProps) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<DryComponentRecord[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const anchorPosRef = useRef<number | null>(null);
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const { ref: gridRef } = useOverlayScrollbars<HTMLDivElement>([open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadRichtextComponents().then((loaded) => {
      if (!cancelled) setRecords(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    anchorPosRef.current = viewRef.current?.state.selection.to ?? null;
    setPending(null);
    setOpen(true);
  };

  const insert = () => {
    const view = viewRef.current;
    const record = records.find((r) => r.name === pending);
    if (!view || !record) return;

    const nodeType = schema.nodes[`dry_${record.name}`];
    if (!nodeType) return;
    const node = nodeType.create({ props: record.defaults });
    const docSize = view.state.doc.content.size;
    const pos = anchorPosRef.current !== null && anchorPosRef.current <= docSize ? anchorPosRef.current : docSize;

    if (record.type === "inline") {
      view.dispatch(view.state.tr.insert(pos, node));
    } else {
      // Block: same shape as `table.ts`'s `insertTable` - grid-cell special
      // case first (`replaceSelectionWith` doesn't land inside a
      // `grid_item`, whose content is exactly one block), then the
      // trailing-empty-paragraph case so a component landing at the very
      // end of the doc still leaves the cursor somewhere to go.
      const gridTr = insertBlockAfterFocusedGridItem(view.state, node);
      let tr = gridTr ?? view.state.tr.replaceSelectionWith(node);
      if (!gridTr && Selection.atEnd(view.state.doc).from === view.state.selection.to) {
        tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph!.createAndFill()!);
      }
      view.dispatch(tr.scrollIntoView());
    }
    setOpen(false);
    view.focus();
  };

  return (
    <>
      <button
        type="button"
        class={`ghost icon ${iconSize}`}
        aria-label="Insert component"
        data-tooltip="Insert component"
        aria-haspopup="dialog"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPicker}
      >
        <ComponentIcon />
      </button>
      <dialog ref={dialogRef} class="file-dialog dry-component-picker-dialog" aria-label="Insert component">
        {open && (
          <>
            <header>
              <h3>Insert component</h3>
            </header>
            <div class="dry-component-picker-grid" ref={gridRef}>
              {records.length === 0 && <p class="dry-component-picker-empty">No components confirmed yet.</p>}
              {records.map((record) => {
                const load = componentModules[record.sourcePath];
                if (!load) return null;
                return (
                  <button
                    type="button"
                    key={record.name}
                    class={`dry-component-picker-item${pending === record.name ? " is-selected" : ""}`}
                    data-tooltip={record.description || undefined}
                    onClick={() => setPending(record.name)}
                  >
                    <ComponentPreview name={record.name} label={record.label} defaults={record.defaults} load={load} />
                    <span class="dry-component-picker-label">{record.label}</span>
                  </button>
                );
              })}
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" disabled={!pending} onClick={insert}>
                Insert
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
