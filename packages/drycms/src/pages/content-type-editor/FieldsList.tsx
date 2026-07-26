import { useEffect, useMemo, useState } from "preact/hooks";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import { fieldTypes } from "../../content-types/field-registry.js";
import type {
  ContentTypeFeatures,
  FieldDefinition,
} from "../../content-types/types.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";
import FieldListItem, { fieldListItemProps } from "./FieldListItem.js";
import { PlusIcon } from "../../components/icons.js";

export interface SystemFieldEntry {
  /** Combined-list id. */
  id: string;
  label: string;
  /** Real technical column name (e.g. `created_at`, not `createdAt`). */
  name: string;
  typeLabel: string;
}

type CombinedEntry =
  | { id: string; system: true; entry: SystemFieldEntry }
  | { id: string; system: false; field: FieldDefinition };

export interface FieldsListProps {
  /** ID always renders first, pinned, non-draggable, non-reorderable. */
  systemEntries: SystemFieldEntry[];
  fields: FieldDefinition[];
  features?: ContentTypeFeatures;
  onEdit: (field: FieldDefinition) => void;
  onRemove: (fieldId: string) => void;
  /** Fires with the custom fields' new relative order whenever the unified
   * list is reordered - system rows never affect the real column order
   * (see the "unified field list" decision), only where OTHER custom fields
   * end up relative to each other. */
  onReorderFields: (fields: FieldDefinition[]) => void;
  onAdd: () => void;
}

/**
 * The unified System + custom Fields list: one flowing, drag-reorderable
 * `<ul>` (system rows look identical to custom ones, just without a
 * click-to-edit or Remove action). `ID` is excluded from the reorderable
 * set entirely and always pinned first - it's a real, fixed primary key,
 * not a field with a position.
 */
export default function FieldsList({
  systemEntries,
  fields,
  features,
  onEdit,
  onRemove,
  onReorderFields,
  onAdd,
}: FieldsListProps) {
  const [pendingRemove, setPendingRemove] = useState<FieldDefinition | null>(
    null,
  );

  const idEntry = systemEntries.find((e) => e.id === "id");
  const reorderableSystem = systemEntries.filter((e) => e.id !== "id");

  const combined: CombinedEntry[] = [
    ...reorderableSystem.map((entry) => ({
      id: entry.id,
      system: true as const,
      entry,
    })),
    ...fields.map((field) => ({ id: field.id, system: false as const, field })),
  ];
  const combinedIds = combined.map((e) => e.id);

  // Ephemeral display order across system+custom rows (see the "unified
  // field list" decision - this never affects the real column order, only
  // where system rows visually sit relative to custom ones). Reconciled
  // whenever the underlying id set changes: existing positions are kept,
  // new ids (a field just added, or a feature just toggled on) are appended.
  const [order, setOrder] = useState<string[]>(combinedIds);
  useEffect(() => {
    setOrder((prev) => {
      const idSet = new Set(combinedIds);
      const kept = prev.filter((id) => idSet.has(id));
      const missing = combinedIds.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
    // Re-run whenever the *set* of ids changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedIds.join(",")]);

  const byId = new Map(combined.map((e) => [e.id, e]));
  const orderedEntries = order
    .map((id) => byId.get(id))
    .filter((e): e is CombinedEntry => !!e);

  const sortable = useSortableList<CombinedEntry>({
    items: orderedEntries,
    getId: (e) => e.id,
    onReorder: (next) => {
      setOrder(next.map((e) => e.id));
      const nextFields = next
        .filter((e): e is CombinedEntry & { system: false } => !e.system)
        .map((e) => e.field);
      onReorderFields(nextFields);
    },
  });

  const featureCount = useMemo(
    () => (!features ? 0 : Object.values(features).filter((i) => i).length),
    [features],
  );

  const fieldCount = systemEntries.length + fields.length;
  const fieldRequired = fields.filter((f) => f.validation?.required).length;

  return (
    <div>
      <div class="row justify-between">
        <div>
          <h3>Fields</h3>
          <span class="hint">
            Define the columns used for data entry and storage
          </span>
        </div>
        <button type="button" class="outline" onClick={onAdd}>
          <PlusIcon /> Add Field
        </button>
      </div>
      <ul class="content-type-list" {...sortable.containerProps}>
        {idEntry && (
          <FieldListItem
            id={idEntry.id}
            label={idEntry.label}
            typeLabel={idEntry.typeLabel}
            name={idEntry.name}
            system
          />
        )}
        {orderedEntries.length === 0 && !idEntry && (
          <li class="hint empty" style={{ marginInline: "1rem" }}>
            No fields yet.
          </li>
        )}
        {orderedEntries.map((item) =>
          item.system ? (
            <FieldListItem
              key={item.id}
              id={item.id}
              label={item.entry.label}
              typeLabel={item.entry.typeLabel}
              name={item.entry.name}
              system
              dragHandleProps={sortable.getHandleProps(item.id)}
              dragging={sortable.draggingId === item.id}
            />
          ) : (
            <FieldListItem
              key={item.id}
              id={item.id}
              {...fieldListItemProps(
                item.field,
                fieldTypes[item.field.type]?.label ?? item.field.type,
              )}
              onEdit={() => onEdit(item.field)}
              onRemove={() => setPendingRemove(item.field)}
              dragHandleProps={sortable.getHandleProps(item.id)}
              dragging={sortable.draggingId === item.id}
            />
          ),
        )}
      </ul>
      <div class="hint" style={{ marginTop: "2rem" }}>
        Total: {fieldCount} field{fieldCount > 1 ? "s" : ""} - {featureCount}{" "}
        feature{featureCount > 1 ? "s" : ""} - {fieldRequired} required
      </div>
      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove "${pendingRemove?.label ?? ""}"?`}
        message={
          <p>
            This removes the field from the schema - saving afterwards will drop
            its column, and any data in it.
          </p>
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
