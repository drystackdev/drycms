import CheckField from "../CheckField.js";
import { PlusIcon, TrashIcon } from "../icons.js";
import NumberField from "../NumberField.js";
import TextField from "../TextField.js";
import type { PlainFieldDef } from "./component-registry-types.js";

export interface DryComponentPropsFormProps {
  schema: Record<string, PlainFieldDef>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

function labelize(key: string): string {
  if (!key) return key;
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function emptyFor(field: PlainFieldDef): unknown {
  if (field.kind === "int") return 0;
  if (field.kind === "boolean") return false;
  if (field.kind === "array") return [];
  if (field.kind === "object") return {};
  return "";
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
export default function DryComponentPropsForm({ schema, value, onChange }: DryComponentPropsFormProps) {
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });

  return (
    <>
      {Object.entries(schema).map(([key, field]) => {
        const label = labelize(key);
        const current = value[key];
        const missing = field.req && (current === undefined || current === null || current === "");

        if (field.kind === "string" || field.kind === "image") {
          const text = typeof current === "string" ? current : "";
          // An empty, non-required value skips length validation entirely -
          // same "empty value short-circuits before minLength/maxLength"
          // precedent as the main content-types system's own
          // `validateColumn` (entry-validate.ts).
          const tooShort = field.kind === "string" && text.length > 0 && field.minLength !== undefined && text.length < field.minLength;
          const tooLong = field.kind === "string" && text.length > 0 && field.maxLength !== undefined && text.length > field.maxLength;
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
                  : (lengthError ?? field.description ?? (field.kind === "image" ? "Image URL" : undefined))
              }
              placeholder={field.kind === "image" ? "https://…" : `e.g. ${label.toLowerCase()}`}
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
                value={current && typeof current === "object" ? (current as Record<string, unknown>) : {}}
                onChange={(next) => set(key, next)}
              />
            </fieldset>
          );
        }

        if (field.kind === "array" && field.inner) {
          const items = Array.isArray(current) ? current : [];
          const inner = field.inner;
          const atMin = field.minCount !== undefined && items.length <= field.minCount;
          const atMax = field.maxCount !== undefined && items.length >= field.maxCount;
          const countError =
            field.minCount !== undefined && items.length < field.minCount
              ? `${label} must have at least ${field.minCount} item${field.minCount === 1 ? "" : "s"}.`
              : field.maxCount !== undefined && items.length > field.maxCount
                ? `${label} must have at most ${field.maxCount} item${field.maxCount === 1 ? "" : "s"}.`
                : null;
          return (
            <fieldset key={key} class="dry-component-props-group">
              <legend>{label}</legend>
              {field.description && <small>{field.description}</small>}
              <ul class="entry-component-repeat-list">
                {items.length === 0 && <li class="hint">No items yet.</li>}
                {items.map((item, index) => (
                  <li class="row" key={index}>
                    <div class="dry-component-props-array-item-field">
                      <DryComponentPropsForm
                        schema={{ item: inner }}
                        value={{ item }}
                        onChange={(next) => {
                          const nextItems = items.slice();
                          nextItems[index] = next.item;
                          set(key, nextItems);
                        }}
                      />
                    </div>
                    <span class="spacer" />
                    <button
                      type="button"
                      class="ghost icon sm"
                      aria-label="Remove item"
                      disabled={atMin}
                      onClick={() => set(key, items.filter((_, i) => i !== index))}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" class="outline" disabled={atMax} onClick={() => set(key, [...items, emptyFor(inner)])}>
                <PlusIcon /> Add {label.toLowerCase()}
              </button>
              {countError && <span class="error">{countError}</span>}
            </fieldset>
          );
        }

        return null;
      })}
    </>
  );
}
