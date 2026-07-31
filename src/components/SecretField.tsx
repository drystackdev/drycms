import { useId } from "preact/hooks";
import Icon from "./Icon.js";
import { secretVisible } from "../store/field-visibility.js";
import type { FieldProps } from "./field-common.js";

export interface SecretFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * Multiline counterpart to `PasswordField` - for a value too long for one
 * line (a private key, a JSON credentials blob, …). A `<textarea>` has no
 * native masking, so hiding it toggles a `.masked` class instead (see the
 * `-webkit-text-security` rule in components.css); its show/hide signal
 * (`store/field-visibility.ts`) is independent of `PasswordField`'s.
 */
export default function SecretField({
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
  class: className,
  style,
}: SecretFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `secret-field-${reactId}`;
  const visible = secretVisible.value;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="select" style={{ paddingLeft: "1rem" }}>
        <textarea
          id={fieldId}
          name={name}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          class={visible ? undefined : "masked"}
          aria-invalid={error || undefined}
          onInput={(event) =>
            onChange((event.target as HTMLTextAreaElement).value)
          }
        />
        <button
          type="button"
          class="select-trailing"
          disabled={disabled}
          aria-label={visible ? "Hide secret" : "Show secret"}
          onClick={() => (secretVisible.value = !visible)}
        >
          <Icon name={visible ? "EyeClosed" : "Eye"} />
        </button>
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
