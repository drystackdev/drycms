import { useId } from "preact/hooks";
import type { FieldProps } from "./field-common.js";

export interface TextFieldProps extends FieldProps<string> {
  /** Renders a `<textarea>` instead of `<input type="text">`. @default false */
  multiline?: boolean;
  /** `<input>`'s own `type` - only meaningful browser-side (keyboard/
   * autofill/validation hints), ignored when `multiline`. @default "text" */
  type?: "text" | "url" | "email";
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

export default function TextField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  multiline = false,
  type = "text",
  placeholder,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: TextFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `text-field-${reactId}`;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      {multiline ? (
        <textarea
          id={fieldId}
          name={name}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error || undefined}
          onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
        />
      ) : (
        <input
          id={fieldId}
          type={type}
          name={name}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error || undefined}
          onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        />
      )}
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
