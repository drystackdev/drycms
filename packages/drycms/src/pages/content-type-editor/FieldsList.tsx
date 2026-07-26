import { useState } from "preact/hooks";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import { fieldTypes } from "../../content-types/field-registry.js";
import type { FieldDefinition } from "../../content-types/types.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";
import FieldListItem from "./FieldListItem.js";

export interface FieldsListProps {
  fields: FieldDefinition[];
  onEdit: (field: FieldDefinition) => void;
  onRemove: (fieldId: string) => void;
  onReorder: (fields: FieldDefinition[]) => void;
  onAdd: () => void;
}

/** The custom-fields list: add/edit/remove/reorder (both drag and the ↑/↓
 * buttons route through the same `onReorder` prop, so there's one code path
 * for "fields got reordered" no matter which affordance triggered it).
 * Owns its own remove-confirmation - removal always asks first. */
export default function FieldsList({ fields, onEdit, onRemove, onReorder, onAdd }: FieldsListProps) {
  const [pendingRemove, setPendingRemove] = useState<FieldDefinition | null>(null);
  const sortable = useSortableList<FieldDefinition>({
    items: fields,
    getId: (field) => field.id,
    onReorder,
  });

  function moveField(fieldId: string, direction: -1 | 1) {
    const index = fields.findIndex((f) => f.id === fieldId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= fields.length) return;
    const next = fields.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onReorder(next);
  }

  return (
    <div>
      <div class="row justify-between">
        <h3>Fields</h3>
        <button type="button" class="outline sm" onClick={onAdd}>
          + Add Field
        </button>
      </div>
      <ul class="content-type-list" {...sortable.containerProps}>
        {fields.length === 0 && <li class="hint">No custom fields yet.</li>}
        {fields.map((field, index) => (
          <FieldListItem
            key={field.id}
            field={field}
            typeLabel={fieldTypes[field.type]?.label ?? field.type}
            onEdit={() => onEdit(field)}
            onRemove={() => setPendingRemove(field)}
            onMoveUp={() => moveField(field.id, -1)}
            onMoveDown={() => moveField(field.id, 1)}
            canMoveUp={index !== 0}
            canMoveDown={index !== fields.length - 1}
            dragHandleProps={sortable.getHandleProps(field.id)}
            dragging={sortable.draggingId === field.id}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove "${pendingRemove?.label ?? ""}"?`}
        message={
          <p>This removes the field from the schema - saving afterwards will drop its column, and any data in it.</p>
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingRemove) onRemove(pendingRemove.id);
          setPendingRemove(null);
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
