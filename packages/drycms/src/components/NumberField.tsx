import { useId } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import { MinusIcon, PlusIcon } from "./icons.js";

export interface NumberFieldProps extends FieldProps<number> {
  min?: number;
  max?: number;
  /** Amount the +/- buttons step by. @default 1 */
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

export default function NumberField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  min,
  max,
  step = 1,
  placeholder,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: NumberFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `number-field-${reactId}`;

  const clamp = (next: number) => {
    let clamped = next;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    return clamped;
  };

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="stepper">
        <button
          type="button"
          aria-label="Decrease"
          disabled={disabled || (min !== undefined && value <= min)}
          onClick={() => onChange(clamp(value - step))}
        >
          <MinusIcon />
        </button>
        <input
          id={fieldId}
          type="number"
          name={name}
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error || undefined}
          onInput={(event) => {
            const next = (event.target as HTMLInputElement).valueAsNumber;
            onChange(clamp(Number.isNaN(next) ? 0 : next));
          }}
        />
        <button
          type="button"
          aria-label="Increase"
          disabled={disabled || (max !== undefined && value >= max)}
          onClick={() => onChange(clamp(value + step))}
        >
          <PlusIcon />
        </button>
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
