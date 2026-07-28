import { useId } from "preact/hooks";
import type { FieldProps } from "./field-common.js";

export interface CheckFieldProps extends FieldProps<boolean> {
  /** Renders a switch instead of a checkbox. @default "checkbox" */
  description?: string;
  role?: "checkbox" | "switch";
  disabled?: boolean;
  name?: string;
  id?: string;
  outline?: boolean;
}

export default function CheckField({
  value,
  onChange,
  label,
  description,
  helperText,
  error = false,
  role = "checkbox",
  disabled = false,
  name,
  id,
  class: className,
  style,
  outline = false
}: CheckFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `check-field-${reactId}`;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <div class={`toggle${outline?' outline':''}`}>
        <input
          id={fieldId}
          type="checkbox"
          role={role === "switch" ? "switch" : undefined}
          name={name}
          checked={value}
          disabled={disabled}
          aria-invalid={error || undefined}
          onChange={(event) => onChange((event.target as HTMLInputElement).checked)}
        />
        <label for={fieldId} style={{gap: 4}}>
          {label}
          {description && <small>{description}</small>}
        </label>
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
