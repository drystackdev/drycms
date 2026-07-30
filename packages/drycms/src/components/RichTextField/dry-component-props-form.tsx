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
          return (
            <TextField
              key={key}
              label={label}
              required={field.req}
              error={missing}
              helperText={missing ? `${label} is required` : field.kind === "image" ? "Image URL" : undefined}
              placeholder={field.kind === "image" ? "https://…" : `e.g. ${label.toLowerCase()}`}
              value={typeof current === "string" ? current : ""}
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
              helperText={missing ? `${label} is required` : undefined}
              value={typeof current === "number" ? current : 0}
              onChange={(next) => set(key, next)}
            />
          );
        }

        if (field.kind === "object" && field.shape) {
          const shape = field.shape;
          return (
            <fieldset key={key} class="dry-component-props-group">
              <legend>{label}</legend>
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
          return (
            <fieldset key={key} class="dry-component-props-group">
              <legend>{label}</legend>
              {items.map((item, index) => (
                <div class="dry-component-props-array-item" key={index}>
                  <DryComponentPropsForm
                    schema={{ item: inner }}
                    value={{ item }}
                    onChange={(next) => {
                      const nextItems = items.slice();
                      nextItems[index] = next.item;
                      set(key, nextItems);
                    }}
                  />
                  <button
                    type="button"
                    class="ghost sm"
                    onClick={() => set(key, items.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" class="outline sm" onClick={() => set(key, [...items, emptyFor(inner)])}>
                Add {label.toLowerCase()}
              </button>
            </fieldset>
          );
        }

        return null;
      })}
    </>
  );
}
