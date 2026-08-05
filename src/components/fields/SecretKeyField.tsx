import { useId } from "preact/hooks";
import type { FieldProps } from "./field-common.js";

export interface SecretKeyFieldProps extends FieldProps<string> {
  /** Whether an entry already has a stored (encrypted) value - changes the
   * placeholder/helper copy, since this input never reflects that value. */
  hasExistingValue?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * `secretkey`'s Editor: a write-only, unmasked multiline input that never
 * receives the decrypted value as `value` - typing stages a NEW secret to be
 * (re-)encrypted on save, leaving the field blank means "keep the current
 * secret" when editing an existing entry. Plain text rather than masked: the
 * value is often a multi-line blob (private key, JSON credentials) where
 * masking would make it impossible to proofread before saving, and the
 * List page never displays this field anyway (see `ContentEntryList.tsx`'s
 * `UNDISPLAYABLE_FIELD_TYPES`), so there's nothing shoulder-surfing gains
 * over a normal `<textarea>`.
 */
export default function SecretKeyField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  hasExistingValue = false,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: SecretKeyFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `secret-key-field-${reactId}`;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="secret-key-field-control">
        <textarea
          id={fieldId}
          name={name}
          value={value}
          autoComplete="off"
          placeholder={hasExistingValue ? "Leave blank to keep the current secret" : "Enter a value"}
          disabled={disabled}
          aria-invalid={error || undefined}
          onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
      />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
