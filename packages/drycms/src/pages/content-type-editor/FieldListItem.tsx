import type { SortableHandleProps } from "../../lib/dnd/useSortableList.js";
import type { FieldSide } from "../../content-types/system-fields.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DragHandleIcon,
  LockIcon,
  TrashIcon,
} from "../../components/icons.js";
import type { FieldDefinition } from "../../content-types/types.js";

export interface FieldListItemProps {
  /** Combined-list id - matches `data-sortable-id` for the drag hook. */
  id: string;
  /** Row 1: "Label [Type]". */
  label: string;
  typeLabel: string;
  required?: boolean;
  /** Row 2: technical column name • description. */
  name: string;
  description?: string;
  /** System rows (Title/Slug/Draft/...) look identical to custom rows, just
   * without a click-to-edit or Remove action - they aren't user-editable. */
  system?: boolean;
  /** A custom field that shipped as part of a `system` content type's
   * default shape (see `seed.ts`) - still click-to-open/reorderable like any
   * other custom field, but its dialog opens read-only (no Remove action
   * either). */
  locked?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  dragHandleProps?: SortableHandleProps;
  dragging?: boolean;
  /** Which entry-editor column (see `ContentEntryEditor.tsx`) this field
   * displays in - the Left/Right toggle only renders when both this and
   * `onSideChange` are provided (omitted entirely for the pinned `id` row,
   * which is never part of the entry form). Editable regardless of `system`/
   * `locked`: purely cosmetic, like drag-reordering already is. */
  side?: FieldSide;
  onSideChange?: (side: FieldSide) => void;
}

/** One row in the unified Fields list (system + custom together). */
export default function FieldListItem({
  id,
  label,
  typeLabel,
  required = false,
  name,
  description,
  system = false,
  locked = false,
  onEdit,
  onRemove,
  dragHandleProps,
  dragging = false,
  side,
  onSideChange,
}: FieldListItemProps) {
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
      <div class="stack spacer" style={{ gap: "0.125rem" }}>
        <span class="row align-center" style={{ gap: "0.25rem" }}>
          {label}
          <span class="badge sm secondary">
            {typeLabel}
          </span>
          {system ? (
            <span class="badge sm outline">
              System
            </span>
          ) : (
            ""
          )}
          {locked && (
            <span
              class="badge sm outline"
              title="Required by default - view only, can't be edited or removed"
            >
              <LockIcon /> Locked
            </span>
          )}
          {required && <span class="required-asterisk">*</span>}
        </span>
        <small class="hint">
          {name}
          {description ? ` • ${description}` : ""}
        </small>
      </div>
      {side && onSideChange && (
        <div
          class="file-view-toggle"
          role="group"
          aria-label="Display side"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            class="ghost icon sm"
            data-tooltip="Show on left"
            aria-pressed={side === "left"}
            aria-label="Show on left"
            onClick={() => onSideChange("left")}
          >
            <ArrowLeftIcon />
          </button>
          <button
            type="button"
            class="ghost icon sm"
            data-tooltip="Show on right"
            aria-pressed={side === "right"}
            aria-label="Show on right"
            onClick={() => onSideChange("right")}
          >
            <ArrowRightIcon />
          </button>
        </div>
      )}
      {!system && !locked && (
        <div class="row" onClick={(event) => event.stopPropagation()}>
          <button type="button" class="ghost sm" onClick={onRemove}>
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
    required: !!field.validation?.required,
    name: field.name,
    description: field.description,
    locked: !!field.locked,
  };
}
