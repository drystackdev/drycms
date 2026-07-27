import { useState } from "preact/hooks";
import { useSortableList } from "../lib/dnd/useSortableList.js";
import { randomUUID } from "../lib/uuid.js";
import { DragHandleIcon, PlusIcon, XIcon } from "./icons.js";

export interface OptionListEditorProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

interface Row {
  /** Local-only, never persisted (the stored shape is plain `string[]`) -
   * exists purely to give `useSortableList`/React keys a stable identity per
   * row, independent of the row's own (editable, possibly duplicated
   * mid-edit) text. Regenerated fresh on every mount - see the component's
   * own doc comment for why no reconciliation-on-prop-change is needed. */
  id: string;
  text: string;
}

/**
 * Select's fixed option list, edited as one compact drag-reorderable block -
 * each option is a single bare text value (no separate machine value vs.
 * display label to fill in). Reuses `useSortableList` (same hook
 * `FieldsList.tsx` uses for the Fields list itself) for the drag handle.
 *
 * Internal `rows` state only ever changes from this component's own
 * add/remove/edit/reorder actions, each of which calls `onChange` with the
 * flattened `string[]` right away - so the `value` prop only ever changes
 * out from under this component when it gets a fresh mount (the dialog
 * closing/reopening, or the field type changing away and back), at which
 * point the lazy `useState` initializer below picks up the new value
 * correctly. No reconciliation effect is needed.
 */
export default function OptionListEditor({ label, value, onChange, disabled = false }: OptionListEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => value.map((text) => ({ id: randomUUID(), text })));

  function commit(next: Row[]) {
    setRows(next);
    onChange(next.map((row) => row.text));
  }

  function updateRow(id: string, text: string) {
    commit(rows.map((row) => (row.id === id ? { ...row, text } : row)));
  }

  function removeRow(id: string) {
    commit(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    commit([...rows, { id: randomUUID(), text: "" }]);
  }

  const sortable = useSortableList<Row>({
    items: rows,
    getId: (row) => row.id,
    onReorder: commit,
    disabled,
  });

  return (
    <div class="field">
      <div class="row justify-between" style={{ alignItems: "center" }}>
        <label>{label}</label>
        <button type="button" class="ghost icon sm" disabled={disabled} aria-label="Add option" onClick={addRow}>
          <PlusIcon />
        </button>
      </div>
      {rows.length === 0 ? (
        <small class="hint">No options yet.</small>
      ) : (
        <ul class="option-list" {...sortable.containerProps}>
          {rows.map((row) => (
            <li
              key={row.id}
              data-sortable-id={row.id}
              class={`option-list-item${sortable.draggingId === row.id ? " dnd-drag-placeholder" : ""}`}
            >
              <button type="button" class="ghost icon sm" {...sortable.getHandleProps(row.id)}>
                <DragHandleIcon />
              </button>
              <input
                type="text"
                class="sm"
                value={row.text}
                placeholder="e.g. In Progress"
                disabled={disabled}
                onInput={(event) => updateRow(row.id, (event.target as HTMLInputElement).value)}
              />
              <button
                type="button"
                class="ghost icon sm"
                disabled={disabled}
                aria-label="Remove option"
                onClick={() => removeRow(row.id)}
              >
                <XIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
