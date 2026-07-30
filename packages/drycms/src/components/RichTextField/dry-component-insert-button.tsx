import { useEffect, useRef, useState } from "preact/hooks";
import { Selection } from "prosemirror-state";
import { path as basePath } from "virtual:drycms/config";
import { ComponentIcon, EyeIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import { useOverlayScrollbars } from "../overlayscrollbars.js";
import Search from "../Search.js";
import ComponentPreview from "./ComponentPreview.js";
import type { DryComponentRecord } from "./component-registry-types.js";
import DryComponentPropsForm, { emptyDryComponentProps, isDryComponentPropsValid } from "./dry-component-props-form.js";
import { loadBuiltComponent } from "./dry-component-runtime.js";
import { insertBlockAfterFocusedGridItem } from "./grid.js";
import { schema } from "./schema.js";
import type { ToolbarCustomProps } from "./types.js";
import { loadRichtextComponents } from "./useRichTextEditor.js";

/**
 * Toolbar button opening a name-only list picker (same 2-step "select, then
 * Insert" shape as `image-insert-button.tsx`'s `FileManager` dialog) - mục 4
 * of `status/register-compoennt.md`. Unlike the admin grid
 * (`RichtextComponents.tsx`), previews aren't rendered inline here; each row
 * has its own eye button opening the same `dry-component-preview-dialog`
 * pattern on demand, so the list stays cheap even with many components.
 */
export default function DryComponentInsertButton({ viewRef, disabled = false, iconSize }: ToolbarCustomProps) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<DryComponentRecord[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<DryComponentRecord | null>(null);
  const [configuring, setConfiguring] = useState<DryComponentRecord | null>(null);
  const [propsDraft, setPropsDraft] = useState<Record<string, unknown>>({});
  const [query, setQuery] = useState("");
  const anchorPosRef = useRef<number | null>(null);
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const previewDialogRef = useDialogSync(!!previewing, () => setPreviewing(null));
  const configureDialogRef = useDialogSync(!!configuring, () => setConfiguring(null));
  const { ref: listRef } = useOverlayScrollbars<HTMLDivElement>([open]);

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
    setPreviewing(null);
    setQuery("");
    setOpen(true);
  };

  const filteredRecords = records.filter((record) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return record.label.toLowerCase().includes(q) || record.name.toLowerCase().includes(q);
  });

  /** Actually creates + places the node, given a resolved `props` value -
   * shared by the no-props fast path (`record.defaults` as-is) and the
   * "configure first" path below (`propsDraft`, once confirmed valid). */
  const performInsert = (record: DryComponentRecord, props: Record<string, unknown>) => {
    const view = viewRef.current;
    if (!view) return;

    const nodeType = schema.nodes[`dry_${record.name}`];
    if (!nodeType) return;
    // `children: true` records need real starting content - `content:
    // "block+"` (schema.ts) requires at least one block, same reason
    // `insertGrid`'s own `buildGrid` seeds a fresh grid item this way.
    const node = record.children
      ? nodeType.create({ props }, schema.nodes.paragraph!.createAndFill()!)
      : nodeType.create({ props });
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
    view.focus();
  };

  /** Footer "Insert" button - a component with no props at all goes straight
   * in with its defaults, same as before. One with props opens a settings
   * dialog first (`DryComponentPropsForm`, the same widget `DryComponentMenu`
   * uses to edit an already-placed instance) seeded *blank* - not
   * `record.defaults` - so inserting a component means actually entering its
   * values, not silently accepting whatever the author defaulted them to;
   * the node is only actually created once that draft passes validation. */
  const startInsert = () => {
    const record = records.find((r) => r.name === pending);
    if (!record) return;
    if (Object.keys(record.props).length === 0) {
      performInsert(record, record.defaults);
      setOpen(false);
      return;
    }
    setConfiguring(record);
    setPropsDraft(emptyDryComponentProps(record.props));
    setOpen(false);
  };

  const confirmConfigure = () => {
    if (!configuring || !isDryComponentPropsValid(configuring.props, propsDraft)) return;
    performInsert(configuring, propsDraft);
    setConfiguring(null);
  };

  const configuringValid = configuring ? isDryComponentPropsValid(configuring.props, propsDraft) : false;

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
              {records.length > 0 && (
                <Search value={query} onChange={setQuery} placeholder="Search components…" autoFocus />
              )}
            </header>
            <div class="dry-component-picker-list" ref={listRef}>
              {/* A single, always-present wrapper - OverlayScrollbars moves
               * this div's DOM node one level down into its own generated
               * `.os-viewport` once it initializes. Its identity never
               * changes across re-renders (only what's *inside* it toggles:
               * empty state, no-match state, the row list), so Preact keeps
               * diffing against this same node wherever OverlayScrollbars
               * relocated it. Toggling content directly on `.dry-component-
               * picker-list` itself - the ref'd host - would have Preact
               * insert/remove those nodes on the *original, pre-wrap* host
               * element, landing them as raw siblings of the viewport
               * instead of inside it (unstyled, shrunk, only fixed by a
               * full remount). */}
              <div class="dry-component-picker-rows">
                {records.length === 0 && <p class="dry-component-picker-empty">No components confirmed yet.</p>}
                {records.length > 0 && filteredRecords.length === 0 && (
                  <p class="dry-component-picker-empty">No components match "{query}".</p>
                )}
                {filteredRecords.map((record) => (
                  <div
                    key={record.name}
                    class={`dry-component-picker-row${pending === record.name ? " is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      class="ghost dry-component-picker-row-select"
                      onClick={() => setPending(record.name)}
                      {...record.description && {"data-tooltip": record.description}}
                    >
                      <span class="dry-component-picker-label">{record.label}</span>
                    </button>
                    <button
                      type="button"
                      class="ghost icon sm"
                      aria-label={`Preview ${record.label}`}
                      data-tooltip="Preview"
                      onClick={() => setPreviewing(record)}
                    >
                      <EyeIcon />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" disabled={!pending} onClick={startInsert}>
                Insert
              </button>
            </footer>
          </>
        )}
      </dialog>
      <dialog
        ref={previewDialogRef}
        class="dry-component-preview-dialog lg"
        aria-label={previewing ? `${previewing.label} preview` : "Component preview"}
      >
        {previewing && (
          <>
            <header>
              <h3>{previewing.label}</h3>
              {previewing.description && <p class="hint">{previewing.description}</p>}
            </header>
            <div class="dry-component-preview-large">
              <ComponentPreview
                name={previewing.name}
                label={previewing.label}
                defaults={previewing.defaults}
                load={loadBuiltComponent(basePath, previewing.name)}
                shadow={previewing.shadow}
                childrenHtml={previewing.childrenDefaultHtml}
              />
            </div>
            <footer>
              <button type="button" onClick={() => setPreviewing(null)}>
                Close
              </button>
            </footer>
          </>
        )}
      </dialog>
      <dialog
        ref={configureDialogRef}
        class="md"
        aria-label={configuring ? `${configuring.label} settings` : "Component settings"}
      >
        {configuring && (
          <>
            <header>
              <h3>{configuring.label}</h3>
            </header>
            <div class="stack">
              <DryComponentPropsForm schema={configuring.props} value={propsDraft} onChange={setPropsDraft} />
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setConfiguring(null)}>
                Cancel
              </button>
              <button type="button" disabled={!configuringValid} onClick={confirmConfigure}>
                Insert
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
