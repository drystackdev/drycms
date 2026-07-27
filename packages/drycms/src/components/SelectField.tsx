import { useId } from "preact/hooks";
import type { SelectFieldConfig } from "../content-types/field-registry.js";
import type { FieldProps } from "./field-common.js";
import type { ListOption } from "./list-nav.js";
import MultiSelect from "./MultiSelect.js";
import Select from "./Select.js";

export interface SelectFieldProps extends FieldProps<string | string[]> {
  config: SelectFieldConfig;
  disabled?: boolean;
  name?: string;
  id?: string;
  description?: string;
}

/**
 * Select's Editor: `config.multiple` picks which of the two existing list
 * controls renders - `Select` for exactly one value, `MultiSelect` for many -
 * against the fixed `config.options` list defined on the field itself (bare
 * strings - `Select`/`MultiSelect` both want `{value,label}` pairs, so each
 * option is expanded to one with itself as both). Neither control renders
 * its own label (see `FieldDialog.tsx`'s `renderControl` for the same
 * wrapping convention), so this owns the `.field`/`<label>` wrapper directly.
 */
export default function SelectField({
  config,
  value,
  onChange,
  label,
  helperText,
  error = false,
  disabled = false,
  name,
  id,
  description,
}: SelectFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `select-field-${reactId}`;
  const options: ListOption[] = config.options.map((text) => ({ value: text, label: text }));

  return (
    <div class="field">
      <label for={fieldId}>{label}</label>
      {description && <small>{description}</small>}
      {config.multiple ? (
        <MultiSelect
          options={options}
          value={Array.isArray(value) ? value : []}
          onChange={(next) => onChange(next)}
          disabled={disabled}
          invalid={error}
          name={name}
          id={fieldId}
        />
      ) : (
        <Select
          options={options}
          value={typeof value === "string" ? value : undefined}
          onChange={(next) => onChange(next)}
          disabled={disabled}
          invalid={error}
          name={name}
          id={fieldId}
        />
      )}
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
