import type { SortableHandleProps } from "../../lib/dnd/useSortableList.js";
import { DragHandleIcon } from "../../components/icons.js";
import type { FieldDefinition } from "../../content-types/types.js";

export interface FieldListItemProps {
  field: FieldDefinition;
  /** Human label for the field's type (e.g. "Text") - omitted entirely for
   * system fields, which have no user-facing type of their own. */
  typeLabel?: string;
  system?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragHandleProps?: SortableHandleProps;
  dragging?: boolean;
}

function summarizeValidation(field: FieldDefinition): string | null {
  const v = field.validation ?? {};
  const parts: string[] = [];
  if (v.required) parts.push("required");
  if (v.unique) parts.push("unique");
  if (v.minLength != null) parts.push(`min length ${v.minLength}`);
  if (v.maxLength != null) parts.push(`max length ${v.maxLength}`);
  if (v.min != null) parts.push(`min ${v.min instanceof Date ? v.min.toLocaleDateString() : v.min}`);
  if (v.max != null) parts.push(`max ${v.max instanceof Date ? v.max.toLocaleDateString() : v.max}`);
  if (v.regex) parts.push("pattern");
  if (v.format && v.format !== "none") parts.push(v.format);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** One row in either the System fields list or the custom Fields list.
 * System rows (`system`) render no actions and no `onEdit` at all - they're
 * genuinely not clickable, not just visually disabled. */
export default function FieldListItem({
  field,
  typeLabel,
  system = false,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  dragHandleProps,
  dragging = false,
}: FieldListItemProps) {
  const summary = summarizeValidation(field);
  return (
    <li
      data-sortable-id={system ? undefined : field.id}
      class={`content-type-list-item row justify-between${system ? " system" : ""}${dragging ? " dnd-dragging" : ""}`}
      onClick={system ? undefined : onEdit}
    >
      <div class="stack" style={{ gap: "0.125rem" }}>
        <span>
          {!system && dragHandleProps && (
            <button
              type="button"
              class="ghost icon sm"
              {...dragHandleProps}
              onClick={(event) => event.stopPropagation()}
            >
              <DragHandleIcon />
            </button>
          )}
          {field.label}
          {field.validation?.required && <span class="required-asterisk">*</span>}
          {typeLabel && <span class="hint"> ({typeLabel})</span>}
        </span>
        {field.description && <span class="hint">{field.description}</span>}
        {summary && <span class="hint">{summary}</span>}
      </div>
      {!system && (
        <div class="row" onClick={(event) => event.stopPropagation()}>
          <button type="button" class="ghost icon sm" disabled={!canMoveUp} onClick={onMoveUp} aria-label="Move up">
            ↑
          </button>
          <button
            type="button"
            class="ghost icon sm"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            aria-label="Move down"
          >
            ↓
          </button>
          <button type="button" class="ghost sm" onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </li>
  );
}
