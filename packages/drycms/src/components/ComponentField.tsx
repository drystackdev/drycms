import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import { DragHandleIcon, PlusIcon, TrashIcon } from "./icons.js";
import { useDialogSync } from "./list-nav.js";
import { useOverlayScrollbars } from "./overlayscrollbars.js";
import { useSortableList } from "../lib/dnd/useSortableList.js";
import { randomUUID } from "../lib/uuid.js";

export interface ComponentFieldProps<
  T = Record<string, unknown>,
> extends FieldProps<T[]> {
  /** Used in the Add button and dialog titles, e.g. "Add SEO block". */
  itemLabel: string;
  /** One-line summary shown in the item list, e.g. the item's title field. */
  summaryOf: (item: T, index: number) => string;
  /** Starting value for a brand-new item. */
  blankItem: () => T;
  /** Renders the item's own fields inside the add/edit dialog - the actual
   * field shape (which may itself nest relations/components) is the
   * caller's concern, same as `ImageField` delegates file-browsing specifics
   * to `FileManager` while still owning its own dialog chrome. */
  renderItem: (value: T, onChange: (value: T) => void) => ComponentChildren;
  disabled?: boolean;
  description?: string;
  /** Lets the item list be manually drag-reordered (via `useSortableList`,
   * the same hook `FieldsList.tsx` uses for schema fields) - order is just
   * `value`'s own array order, nothing extra to persist. @default false */
  sortable?: boolean;
}

/**
 * Repeatable-item field: an editable list of summaries, each opening an
 * add/edit dialog for one item's own fields (via `renderItem`) - same
 * trigger-card-opens-a-dialog shape as `RelationField`/`ImageField`, just for
 * a repeatable group of fields instead of a single value.
 */
export default function ComponentField<T = Record<string, unknown>>({
  value,
  onChange,
  label,
  helperText,
  error = false,
  itemLabel,
  summaryOf,
  blankItem,
  renderItem,
  disabled = false,
  description,
  sortable = false,
  class: className,
  style,
}: ComponentFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const dialogRef = useDialogSync(open, () => setOpen(false));
  // Deps include `open`: the body only mounts once the dialog opens, so the
  // ref is still null on this component's own first render.
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);

  // `value`'s items have no stable id of their own (they're plain data, not
  // entities) - `useSortableList` needs one to track a row across reorders,
  // so this mints one per item and keeps it in lockstep with `value` across
  // every mutation this component itself makes (add/remove/reorder).
  const [itemIds, setItemIds] = useState<string[]>(() => value.map(() => randomUUID()));

  function openAdd() {
    setEditingIndex(null);
    setDraft(blankItem());
    setOpen(true);
  }

  function openEdit(index: number) {
    setEditingIndex(index);
    setDraft(value[index] ?? blankItem());
    setOpen(true);
  }

  function removeItem(index: number) {
    onChange(value.filter((_, i) => i !== index));
    setItemIds((ids) => ids.filter((_, i) => i !== index));
  }

  function save() {
    if (draft === null) return;
    if (editingIndex === null) {
      onChange([...value, draft]);
      setItemIds((ids) => [...ids, randomUUID()]);
    } else {
      onChange(value.map((existing, i) => (i === editingIndex ? draft : existing)));
    }
    setOpen(false);
    setDraft(null);
  }

  const dnd = useSortableList<{ id: string; item: T }>({
    items: value.map((item, i) => ({ id: itemIds[i] ?? String(i), item })),
    getId: (row) => row.id,
    onReorder: (next) => {
      onChange(next.map((row) => row.item));
      setItemIds(next.map((row) => row.id));
    },
    disabled: disabled || !sortable,
  });

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label>{label}</label>
      {description && <small>{description}</small>}
      <div style={{marginTop: "0.5rem"}}>
        <button
          type="button"
          class="outline"
          disabled={disabled}
          onClick={openAdd}
        >
          <PlusIcon /> Add {itemLabel}
        </button>
      </div>
      <ul class="entry-component-repeat-list" {...dnd.containerProps}>
        {value.length === 0 && <li class="hint">No items yet.</li>}
        {value.map((item, index) => {
          const id = itemIds[index] ?? String(index);
          return (
            <li
              key={id}
              data-sortable-id={sortable ? id : undefined}
              class={`row${dnd.draggingId === id ? " dnd-drag-placeholder" : ""}`}
            >
              {sortable && (
                <button
                  type="button"
                  class="ghost icon sm"
                  disabled={disabled}
                  {...(disabled ? {} : dnd.getHandleProps(id))}
                >
                  <DragHandleIcon />
                </button>
              )}
              <button
                type="button"
                class="link"
                disabled={disabled}
                onClick={() => openEdit(index)}
              >
                {summaryOf(item, index) || `Item ${index + 1}`}
              </button>
              <span class="spacer" />
              <button
                type="button"
                class="ghost icon sm"
                aria-label="Remove item"
                disabled={disabled}
                onClick={() => removeItem(index)}
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}

      <dialog
        ref={dialogRef}
        class="md component-item-dialog"
        aria-label={
          editingIndex === null ? `Add ${itemLabel}` : `Edit ${itemLabel}`
        }
      >
        {open && draft !== null && (
          <>
            <header>
              <h3>
                {editingIndex === null
                  ? `Add ${itemLabel}`
                  : `Edit ${itemLabel}`}
              </h3>
            </header>
            <div class="component-item-dialog-body" ref={bodyScroll}>
              <div class="stack">{renderItem(draft, setDraft)}</div>
            </div>
            <footer class="row justify-end">
              <button
                type="button"
                class="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button type="button" onClick={save}>
                Save
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
