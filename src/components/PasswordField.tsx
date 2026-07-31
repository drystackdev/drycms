import { useId } from "preact/hooks";
import Icon from "./Icon.js";
import { passwordVisible } from "../store/field-visibility.js";
import type { FieldProps } from "./field-common.js";

export interface PasswordFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
  /** @default "new-password" */
  autoComplete?: string;
}

/**
 * Like `TextField`, but for `type="password"` values - a trailing eye button
 * toggles it to plain text. The show/hide state is a single signal shared by
 * every `PasswordField` on the page (`store/field-visibility.ts`), so
 * revealing one reveals them all for the rest of the session.
 */
export default function PasswordField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  placeholder,
  disabled = false,
  name,
  id,
  required = false,
  description,
  autoComplete = "new-password",
  class: className,
  style,
}: PasswordFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `password-field-${reactId}`;
  const visible = passwordVisible.value;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="select" style={{ paddingLeft: "1rem" }}>
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          name={name}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error || undefined}
          onInput={(event) =>
            onChange((event.target as HTMLInputElement).value)
          }
        />
        <button
          type="button"
          class="select-trailing"
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => (passwordVisible.value = !visible)}
        >
          <Icon name={visible ? "EyeClosed" : "Eye"} />
        </button>
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
