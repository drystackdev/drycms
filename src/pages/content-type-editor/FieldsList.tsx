import { useMemo } from "preact/hooks";
import { fieldTypes } from "../../content-types/field-registry.js";
import { applyFieldOrder } from "../../content-types/system-fields.js";
import type {
  ContentTypeFeatures,
  FieldDefinition,
} from "../../content-types/types.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";
import FieldListItem, { fieldListItemProps } from "./FieldListItem.js";
import { ArchiveIcon, PlusIcon } from "../../components/icons.js";
import type { JSX } from "preact/jsx-runtime";

export interface SystemFieldEntry {
  /** Combined-list id. */
  id: string;
  label: string;
  /** Real technical column name, as actually stored/migrated. */
  name: string;
  typeLabel: string;
  /** `FieldTypeDefinition.key` this row stands for (e.g. "slug", "boolean") -
   * threaded straight through to `FieldListItem`'s icon/color lookup, same as
   * a real `FieldDefinition.type`. */
  type?: string;
  /** When this one row actually stands for more than one real system field id
   * (e.g. the `features.slug` Title+Slug pair, shown/dragged as a single
   * "Title & Slug" row) - the full list of real ids, in their fixed relative
   * order, to write into `fieldOrder` in this row's place. Defaults to `[id]`
   * when absent. */
  groupedIds?: string[];
  /** Only for a system row with no description of its own (i.e. a
   * `relationmirror` row - see `mirror` below); real custom fields carry
   * their own `FieldDefinition.description` instead, threaded through
   * `fieldListItemProps`. */
  description?: string;
  /** Set only for an auto-generated `relationmirror` row (see
   * `system-fields.ts`'s `relationMirrorFieldsFor`) - unlike every other
   * system row, these ARE clickable (opens the same `FieldDialog` as a real
   * field, with Label/Name/Type locked but Description and Display side
   * still editable) and removable (deletes the REAL `relation` field on the
   * OTHER type this one mirrors, since the row itself is just a reflection,
   * not a field of its own to remove). */
  mirror?: {
    sourceTypeId: string;
    sourceTypeLabel: string;
    sourceFieldId: string;
    sourceFieldLabel: string;
  };
}

type CombinedEntry =
  | { id: string; system: true; entry: SystemFieldEntry }
  | { id: string; system: false; field: FieldDefinition };

export interface FieldsListProps {
  systemEntries: SystemFieldEntry[];
  fields: FieldDefinition[];
  type: string;
  name: string;
  description?: string;
  features?: ContentTypeFeatures;
  /** Ids (from `fields`) that can be viewed/opened but never edited or
   * removed - see `types.ts`'s `ContentTypeDefinition.protectedFieldIds`.
   * Rendered with a "Protected" badge and no Remove action, same visual
   * treatment as a system row minus the click-to-edit lock (opening one
   * still works, just read-only - see `FieldDialog`'s `readOnly` prop). */
  protectedFieldIds?: string[];
  /** Persisted display order (see `types.ts`'s `ContentTypeDefinition.fieldOrder`) -
   * a permutation of `systemEntries`'/`fields`' ids. Applied via
   * `system-fields.ts`'s `applyFieldOrder`; missing/stale ids just fall back
   * to natural order, so this never needs to be kept in lockstep with
   * `systemEntries`/`fields` by the caller. */
  fieldOrder?: string[];
  onEdit: (field: FieldDefinition) => void;
  onRemove: (fieldId: string) => void;
  /** Fires when a `mirror` system row is clicked - see `SystemFieldEntry.mirror`. */
  onEditMirror: (entry: SystemFieldEntry) => void;
  /** Fires when a `mirror` system row's Remove is clicked. */
  onRemoveMirror: (entry: SystemFieldEntry) => void;
  /** Fires with the custom fields' new relative order whenever the unified
   * list is reordered - drives the real column order (see `naming.ts`'s
   * `normalizeFieldOrder`), independent of `onReorderAll`'s display order. */
  onReorderFields: (fields: FieldDefinition[]) => void;
  /** Fires with the FULL combined id order (system rows and custom fields
   * alike) whenever the unified list is reordered - purely the on-screen
   * order (`ContentTypeDefinition.fieldOrder`), never the real column
   * order. */
  onReorderAll: (order: string[]) => void;
  onAdd: () => void;
  /** Only an EXISTING content type has an archive to show/open - see
   * `types.ts`'s `deletedFieldIds` doc comment for why a brand-new one skips
   * it entirely. The button itself only renders once `trashCount` is above
   * 0 - nothing to open, nothing to show. */
  showTrash: boolean;
  trashCount: number;
  onOpenTrash: () => void;
}

/**
 * The unified System + custom Fields list: one flowing, drag-reorderable
 * `<ul>` (system rows look identical to custom ones, just without a
 * click-to-edit or Remove action - EXCEPT `mirror` rows, which get both, see
 * `SystemFieldEntry.mirror`).
 */
export default function FieldsList({
  systemEntries,
  fields,
  features,
  protectedFieldIds,
  fieldOrder,
  onEdit,
  onRemove,
  onEditMirror,
  onRemoveMirror,
  onReorderFields,
  onReorderAll,
  onAdd,
  type,
  name,
  description,
  showTrash,
  trashCount,
  onOpenTrash,
}: FieldsListProps) {
  const protectedSet = new Set(protectedFieldIds ?? []);
  const combined: CombinedEntry[] = [
    ...fields.map((field) => ({ id: field.id, system: false as const, field })),
    ...systemEntries.map((entry) => ({
      id: entry.id,
      system: true as const,
      entry,
    })),
  ];

  // Display order is fully derived from props - `fieldOrder` (persisted) wins
  // for whatever ids it lists, in that sequence; anything not listed (a field
  // just added, or a feature just toggled on) keeps its natural position -
  // custom fields first, system/mirror rows after - appended there. No local
  // state: reorders round-trip through the parent (`onReorderAll` ->
  // `ContentTypeDefinition.fieldOrder` -> this `fieldOrder` prop), same
  // one-way flow already used for `fields`/`onReorderFields`.
  const orderedEntries = applyFieldOrder(combined, fieldOrder);

  const sortable = useSortableList<CombinedEntry>({
    items: orderedEntries,
    getId: (e) => e.id,
    onReorder: (next) => {
      onReorderAll(
        next.flatMap((e) => (e.system ? (e.entry.groupedIds ?? [e.id]) : [e.id])),
      );
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
          <h4>
            {type}
          </h4>
          <span class="hint">
            {name && <span class="badge sm outline">{name}</span>} {description || "Define the columns used for data entry and storage"}
          </span>
        </div>
        <button type="button" class="outline" onClick={onAdd}>
          <PlusIcon /> Add Field
        </button>
      </div>
      <ul class="content-type-list" {...sortable.containerProps}>
        {orderedEntries.length === 0 && (
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
              type={item.entry.type}
              name={item.entry.name}
              description={item.entry.description}
              system={!item.entry.mirror}
              onEdit={item.entry.mirror ? () => onEditMirror(item.entry) : undefined}
              onRemove={item.entry.mirror ? () => onRemoveMirror(item.entry) : undefined}
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
              protected={protectedSet.has(item.field.id)}
              onEdit={() => onEdit(item.field)}
              onRemove={() => onRemove(item.field.id)}
              dragHandleProps={sortable.getHandleProps(item.id)}
              dragging={sortable.draggingId === item.id}
            />
          ),
        )}
      </ul>
      <div class="row justify-between" style={{ marginTop: "2rem" }}>
        <div class="hint">
          Total: {fieldCount} field{fieldCount > 1 ? "s" : ""} - {featureCount}{" "}
          feature{featureCount > 1 ? "s" : ""} - {fieldRequired} required
        </div>
        {showTrash && trashCount > 0 && (
          <button type="button" class="ghost sm" onClick={onOpenTrash}>
            <ArchiveIcon /> Archive <span class="badge sm outline">{trashCount}</span>
          </button>
        )}
      </div>
    </div>
  );
}
