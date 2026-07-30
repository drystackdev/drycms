import { useState } from "preact/hooks";
import CheckField from "../CheckField.js";
import { DragHandleIcon, PlusIcon, TrashIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import NumberField from "../NumberField.js";
import TextField from "../TextField.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";
import { randomUUID } from "../../lib/uuid.js";
import type { PlainFieldDef } from "./component-registry-types.js";

export interface DryComponentPropsFormProps {
  schema: Record<string, PlainFieldDef>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

function labelize(key: string): string {
  if (!key) return key;
  return (
    key.charAt(0).toUpperCase() +
    key.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}

/**
 * Recursive validity check mirroring the inline error rules `DryComponentPropsForm`
 * itself computes per-field (`missing`/length/count) - used wherever a caller
 * needs a single yes/no *before* accepting a props draft (`dry-component-
 * insert-button.tsx`'s "enter props, then insert" dialog gates its own
 * confirm button on this) rather than rendering the form's own inline errors.
 */
export function isDryComponentPropsValid(
  schema: Record<string, PlainFieldDef>,
  value: Record<string, unknown>,
): boolean {
  return Object.entries(schema).every(([key, field]) => {
    const current = value[key];
    if (
      field.req &&
      (current === undefined || current === null || current === "")
    )
      return false;

    if (field.kind === "string" || field.kind === "image") {
      const text = typeof current === "string" ? current : "";
      if (
        text.length > 0 &&
        field.minLength !== undefined &&
        text.length < field.minLength
      )
        return false;
      if (
        text.length > 0 &&
        field.maxLength !== undefined &&
        text.length > field.maxLength
      )
        return false;
      return true;
    }

    if (field.kind === "array") {
      const items = Array.isArray(current) ? current : [];
      if (field.minCount !== undefined && items.length < field.minCount)
        return false;
      if (field.maxCount !== undefined && items.length > field.maxCount)
        return false;
      return field.inner
        ? items.every((item) =>
            isDryComponentPropsValid({ item: field.inner! }, { item }),
          )
        : true;
    }

    if (field.kind === "object" && field.shape) {
      const obj =
        current && typeof current === "object"
          ? (current as Record<string, unknown>)
          : {};
      return isDryComponentPropsValid(field.shape, obj);
    }

    return true;
  });
}

function emptyFor(field: PlainFieldDef): unknown {
  if (field.kind === "int") return 0;
  if (field.kind === "boolean") return false;
  if (field.kind === "array") return [];
  if (field.kind === "object") return {};
  return "";
}

/** One-line preview shown in an array item's row - the field's own value,
 * not a re-render of its inputs (those only appear once the row is clicked
 * open into the edit dialog). */
function summarizeItem(item: unknown, inner: PlainFieldDef): string {
  if (inner.kind === "string" || inner.kind === "image")
    return typeof item === "string" ? item : "";
  if (inner.kind === "int") return typeof item === "number" ? String(item) : "";
  if (inner.kind === "boolean") return item === true ? "Yes" : "No";
  if (inner.kind === "array")
    return Array.isArray(item)
      ? `${item.length} item${item.length === 1 ? "" : "s"}`
      : "";
  if (inner.kind === "object" && inner.shape) {
    const obj =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const firstKey = Object.keys(inner.shape)[0];
    const firstValue = firstKey ? obj[firstKey] : undefined;
    return typeof firstValue === "string" ? firstValue : "";
  }
  return "";
}

interface DryComponentPropsArrayFieldProps {
  label: string;
  field: PlainFieldDef;
  items: unknown[];
  onChange: (next: unknown[]) => void;
}

/**
 * One array prop's row list + add/edit dialog - same drag-to-reorder,
 * click-a-row-to-edit-in-a-dialog shape as `ComponentField.tsx` (not reused
 * directly: min/maxCount gating here has no equivalent there). A row shows
 * only `summarizeItem`'s preview; the field's own input(s) only exist inside
 * the "md"-sized dialog, opened on click.
 */
function DryComponentPropsArrayField({
  label,
  field,
  items,
  onChange,
}: DryComponentPropsArrayFieldProps) {
  const inner = field.inner!;
  const [open, setOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [itemIds, setItemIds] = useState<string[]>(() =>
    items.map(() => randomUUID()),
  );
  const dialogRef = useDialogSync(open, () => setOpen(false));

  const atMin = field.minCount !== undefined && items.length <= field.minCount;
  const atMax = field.maxCount !== undefined && items.length >= field.maxCount;
  const countError =
    field.minCount !== undefined && items.length < field.minCount
      ? `${label} must have at least ${field.minCount} item${field.minCount === 1 ? "" : "s"}.`
      : field.maxCount !== undefined && items.length > field.maxCount
        ? `${label} must have at most ${field.maxCount} item${field.maxCount === 1 ? "" : "s"}.`
        : null;

  const openAdd = () => {
    setEditingIndex(null);
    setDraft(emptyFor(inner));
    setOpen(true);
  };

  const openEdit = (index: number) => {
    setEditingIndex(index);
    setDraft(items[index]);
    setOpen(true);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    setItemIds((ids) => ids.filter((_, i) => i !== index));
  };

  const save = () => {
    if (editingIndex === null) {
      onChange([...items, draft]);
      setItemIds((ids) => [...ids, randomUUID()]);
    } else {
      onChange(
        items.map((existing, i) => (i === editingIndex ? draft : existing)),
      );
    }
    setOpen(false);
  };

  const dnd = useSortableList<{ id: string; item: unknown }>({
    items: items.map((item, i) => ({ id: itemIds[i] ?? String(i), item })),
    getId: (row) => row.id,
    onReorder: (next) => {
      onChange(next.map((row) => row.item));
      setItemIds(next.map((row) => row.id));
    },
  });

  return (
    <fieldset class="dry-component-props-group">
      <legend>{label}</legend>
      {field.description && <small>{field.description}</small>}
      <ul class="entry-component-repeat-list" {...dnd.containerProps}>
        {items.length === 0 && <li class="center hint" style={{paddingBlock: ".5rem"}}>No items yet.</li>}
        {items.map((item, index) => {
          const id = itemIds[index] ?? String(index);
          return (
            <li
              key={id}
              data-sortable-id={id}
              class={`row${dnd.draggingId === id ? " dnd-drag-placeholder" : ""}`}
            >
              <button
                type="button"
                class="ghost icon sm"
                {...dnd.getHandleProps(id)}
              >
                <DragHandleIcon />
              </button>
              <button
                type="button"
                class="link"
                onClick={() => openEdit(index)}
              >
                {summarizeItem(item, inner) || `Item ${index + 1}`}
              </button>
              <span class="spacer" />
              <button
                type="button"
                class="ghost icon sm"
                aria-label="Remove item"
                disabled={atMin}
                onClick={() => removeItem(index)}
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
      <div>
        <button
          type="button"
          class="outline"
          disabled={atMax}
          onClick={openAdd}
        >
          <PlusIcon /> Add {label.toLowerCase()}
        </button>
      </div>
      {countError && <span class="error">{countError}</span>}

      <dialog
        ref={dialogRef}
        class="md dry-component-props-array-item-dialog"
        aria-label={editingIndex === null ? `Add ${label}` : `Edit ${label}`}
      >
        {open && (
          <>
            <header>
              <h3>
                {editingIndex === null ? `Add ${label}` : `Edit ${label}`}
              </h3>
            </header>
            <div class="stack">
              <DryComponentPropsForm
                schema={{ item: inner }}
                value={{ item: draft }}
                onChange={(next) => setDraft(next.item)}
              />
            </div>
            <footer>
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
    </fieldset>
  );
}

/**
 * Recursive props-edit form driven by a component's persisted schema
 * (`PlainFieldDef` tree, mục 9 of `status/register-compoennt.md`) - reuses
 * the same widget-level inputs as `content-entry-editor/ScalarField.tsx`
 * (`TextField`/`NumberField`), NOT the heavier `content-types/field-registry.ts`
 * (DB/relation-coupled, not a fit for props local to one node). `object`
 * nests a `<fieldset>` recursing into itself; `array` renders a repeatable
 * list the same way, one recursive call per item. `req` fields missing a
 * value show their error inline on the field itself, never a toast (house
 * rule).
 */
export default function DryComponentPropsForm({
  schema,
  value,
  onChange,
}: DryComponentPropsFormProps) {
  const set = (key: string, next: unknown) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      {Object.entries(schema).map(([key, field]) => {
        const label = labelize(key);
        const current = value[key];
        const missing =
          field.req &&
          (current === undefined || current === null || current === "");

        if (field.kind === "string" || field.kind === "image") {
          const text = typeof current === "string" ? current : "";
          // An empty, non-required value skips length validation entirely -
          // same "empty value short-circuits before minLength/maxLength"
          // precedent as the main content-types system's own
          // `validateColumn` (entry-validate.ts).
          const tooShort =
            field.kind === "string" &&
            text.length > 0 &&
            field.minLength !== undefined &&
            text.length < field.minLength;
          const tooLong =
            field.kind === "string" &&
            text.length > 0 &&
            field.maxLength !== undefined &&
            text.length > field.maxLength;
          const lengthError = tooShort
            ? `${label} must be at least ${field.minLength} characters.`
            : tooLong
              ? `${label} must be at most ${field.maxLength} characters.`
              : null;
          return (
            <TextField
              key={key}
              label={label}
              required={field.req}
              error={missing || !!lengthError}
              helperText={
                missing
                  ? `${label} is required`
                  : (lengthError ??
                    field.description ??
                    (field.kind === "image" ? "Image URL" : undefined))
              }
              placeholder={
                field.kind === "image"
                  ? "https://…"
                  : `e.g. ${label.toLowerCase()}`
              }
              value={text}
              onChange={(next) => set(key, next)}
            />
          );
        }

        if (field.kind === "int") {
          return (
            <NumberField
              key={key}
              label={label}
              required={field.req}
              error={missing}
              helperText={missing ? `${label} is required` : field.description}
              value={typeof current === "number" ? current : 0}
              onChange={(next) => set(key, next)}
            />
          );
        }

        if (field.kind === "boolean") {
          return (
            <CheckField
              key={key}
              label={label}
              description={field.description}
              role="switch"
              value={current === true}
              onChange={(next) => set(key, next)}
            />
          );
        }

        if (field.kind === "object" && field.shape) {
          const shape = field.shape;
          return (
            <fieldset key={key} class="dry-component-props-group">
              <legend>{label}</legend>
              {field.description && <small>{field.description}</small>}
              <DryComponentPropsForm
                schema={shape}
                value={
                  current && typeof current === "object"
                    ? (current as Record<string, unknown>)
                    : {}
                }
                onChange={(next) => set(key, next)}
              />
            </fieldset>
          );
        }

        if (field.kind === "array" && field.inner) {
          const items = Array.isArray(current) ? current : [];
          return (
            <DryComponentPropsArrayField
              key={key}
              label={label}
              field={field}
              items={items}
              onChange={(next) => set(key, next)}
            />
          );
        }

        return null;
      })}
    </>
  );
}
