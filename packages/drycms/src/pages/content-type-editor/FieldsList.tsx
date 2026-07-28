import { useMemo, useState } from "preact/hooks";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import { fieldTypes } from "../../content-types/field-registry.js";
import {
  applyFieldOrder,
  resolveFieldSide,
  type FieldSide,
} from "../../content-types/system-fields.js";
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
  /** Real technical column name, as actually stored/migrated. */
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
  type: string;
  features?: ContentTypeFeatures;
  /** Persisted display order (see `types.ts`'s `ContentTypeDefinition.fieldOrder`) -
   * a permutation of `systemEntries`'/`fields`' ids (`id` itself excluded, always
   * pinned first regardless). Applied via `system-fields.ts`'s `applyFieldOrder`;
   * missing/stale ids just fall back to natural order, so this never needs
   * to be kept in lockstep with `systemEntries`/`fields` by the caller. */
  fieldOrder?: string[];
  /** Persisted per-field entry-editor column (see `types.ts`'s
   * `ContentTypeDefinition.fieldSides`), keyed the same way as `fieldOrder`.
   * Missing ids fall back to `system-fields.ts`'s `defaultFieldSide` via
   * `resolveFieldSide`. */
  fieldSides?: Record<string, FieldSide>;
  onSideChange: (id: string, side: FieldSide) => void;
  /** `false` for `component`-kind types: their fields only ever render
   * nested inside a parent's flatten/repeat form (see `FieldRenderer.tsx`),
   * which never splits left/right, so the toggle would have no effect. */
  showSideToggle: boolean;
  onEdit: (field: FieldDefinition) => void;
  onRemove: (fieldId: string) => void;
  /** Fires with the custom fields' new relative order whenever the unified
   * list is reordered - drives the real column order (see `naming.ts`'s
   * `normalizeFieldOrder`), independent of `onReorderAll`'s display order. */
  onReorderFields: (fields: FieldDefinition[]) => void;
  /** Fires with the FULL combined id order (system rows and custom fields
   * alike, `id` excluded) whenever the unified list is reordered - purely
   * the on-screen order (`ContentTypeDefinition.fieldOrder`), never the real
   * column order. */
  onReorderAll: (order: string[]) => void;
  onAdd: () => void;
  /** When true, this content type's structure is fully frozen (`role`/
   * `permission`/`aiKey` - see `types.ts`'s `structureLocked`):
   * hides the "+ Add Field" button. Existing fields can still be reordered/
   * edited - only adding new ones is blocked. */
  structureLocked?: boolean;
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
  fieldOrder,
  fieldSides,
  onSideChange,
  showSideToggle,
  onEdit,
  onRemove,
  onReorderFields,
  onReorderAll,
  onAdd,
  type,
  structureLocked,
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

  // Display order is fully derived from props - `fieldOrder` (persisted) wins
  // for whatever ids it lists, in that sequence; anything not listed (a field
  // just added, or a feature just toggled on) keeps its natural position,
  // appended after. No local state: reorders round-trip through the parent
  // (`onReorderAll` -> `ContentTypeDefinition.fieldOrder` -> this `fieldOrder`
  // prop), same one-way flow already used for `fields`/`onReorderFields`.
  const orderedEntries = applyFieldOrder(combined, fieldOrder);

  const sortable = useSortableList<CombinedEntry>({
    items: orderedEntries,
    getId: (e) => e.id,
    onReorder: (next) => {
      onReorderAll(next.map((e) => e.id));
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
          <h3>
            Fields
            <div class="badge sm info" style={{ position: "relative", top: "-0.125rem", marginLeft: "0.5rem" }}>
              {type}
            </div>
          </h3>
          <span class="hint">
            Define the columns used for data entry and storage
          </span>
        </div>
        {!structureLocked && (
          <button type="button" class="outline" onClick={onAdd}>
            <PlusIcon /> Add Field
          </button>
        )}
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
              side={
                showSideToggle
                  ? resolveFieldSide(item.id, false, fieldSides)
                  : undefined
              }
              onSideChange={
                showSideToggle
                  ? (side) => onSideChange(item.id, side)
                  : undefined
              }
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
              side={
                showSideToggle
                  ? resolveFieldSide(
                      item.id,
                      item.field.type === "relation" ||
                        item.field.type === "component",
                      fieldSides,
                    )
                  : undefined
              }
              onSideChange={
                showSideToggle
                  ? (side) => onSideChange(item.id, side)
                  : undefined
              }
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
