import type { SortableHandleProps } from "../../lib/dnd/useSortableList.js";
import { DragHandleIcon, TextFieldTypeIcon, TrashIcon } from "../../components/icons.js";
import { fieldTypeColors, fieldTypeIcons } from "../../components/field-type-icons.js";
import type { FieldDefinition } from "../../content-types/types.js";

export interface FieldListItemProps {
  /** Combined-list id - matches `data-sortable-id` for the drag hook. */
  id: string;
  /** Row 1: "Label [Type]". */
  label: string;
  typeLabel: string;
  /** `FieldTypeDefinition.key` (e.g. "text", "relation") - looked up in
   * `field-type-icons.ts`'s `fieldTypeIcons`/`fieldTypeColors` for this row's
   * icon, same mapping the showcase nav uses. Falls back to the plain text
   * icon in its default color when absent/unrecognized. */
  type?: string;
  required?: boolean;
  /** Row 2: technical column name • description. */
  name: string;
  description?: string;
  /** System rows (Title/Slug/Draft/...) look identical to custom rows, just
   * without a click-to-edit or Remove action - they aren't real fields, just
   * synthetic columns a feature toggle adds. */
  system?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  dragHandleProps?: SortableHandleProps;
  dragging?: boolean;
}

/** One row in the unified Fields list (system + custom together). */
export default function FieldListItem({
  id,
  label,
  typeLabel,
  type,
  required = false,
  name,
  description,
  system = false,
  onEdit,
  onRemove,
  dragHandleProps,
  dragging = false,
}: FieldListItemProps) {
  const TypeIcon = (type && fieldTypeIcons[type]) || TextFieldTypeIcon;
  const color = type ? fieldTypeColors[type] : undefined;
  return (
    <li
      data-sortable-id={dragHandleProps ? id : undefined}
      class={`content-type-list-item row justify-between${system ? " system" : ""}${dragging ? " dnd-drag-placeholder" : ""}`}
      onClick={system ? undefined : onEdit}
    >
      <button
        type="button"
        class="ghost icon sm"
        {...(dragHandleProps ?? { disabled: true })}
        onClick={(event) => event.stopPropagation()}
      >
        <DragHandleIcon />
      </button>
      <div class="content-type-list-item-item" style={color ? { color } : undefined}>
        <TypeIcon />
      </div>
      <div class="stack spacer" style={{ gap: "0.125rem" }}>
        <span class="row align-center" style={{ gap: "0.25rem" }}>
          {label}
          {/* <span class="badge sm secondary">
            {typeLabel}
          </span> */}
          {system ? (
            <span class="badge sm outline">
              System
            </span>
          ) : (
            ""
          )}
          {required && <span class="required-asterisk">*</span>}
        </span>
        <small class="hint">
          {name}
          {description ? ` • ${description}` : ""}
        </small>
      </div>
      {!system && (
        <div class="row" onClick={(event) => event.stopPropagation()}>
          <button type="button" class="ghost sm" aria-label="Remove" onClick={onRemove}>
            <TrashIcon />
          </button>
        </div>
      )}
    </li>
  );
}

/** Maps a custom `FieldDefinition` to `FieldListItem`'s display props. */
export function fieldListItemProps(field: FieldDefinition, typeLabel: string) {
  return {
    label: field.label,
    typeLabel,
    type: field.type,
    required: !!field.validation?.required,
    name: field.name,
    description: field.description,
  };
}
