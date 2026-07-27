import { useId } from "preact/hooks";
import type { FieldProps } from "./field-common.js";

export interface SecretKeyFieldProps extends FieldProps<string> {
  /** Whether an entry already has a stored (encrypted) value - changes the
   * placeholder/helper copy, since this input never reflects that value. */
  hasExistingValue?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  description?: string;
}

/**
 * `secretkey`'s Editor: a write-only masked input that never receives the
 * decrypted value as `value` - typing stages a NEW secret to be (re-)encrypted
 * on save, leaving the field blank means "keep the current secret" when
 * editing an existing entry. Not called anywhere yet (no entry-CRUD UI
 * exists - see `content-types/field-registry.ts`'s doc comments on
 * `relation`/`component`/`password`), same as this project's other unwired
 * Editors.
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
  description,
}: SecretKeyFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `secret-key-field-${reactId}`;

  return (
    <div class="field">
      <label for={fieldId}>{label}</label>
      {description && <small>{description}</small>}
      <input
        id={fieldId}
        type="password"
        name={name}
        value={value}
        autoComplete="new-password"
        placeholder={hasExistingValue ? "Leave blank to keep the current secret" : "Enter a value"}
        disabled={disabled}
        aria-invalid={error || undefined}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
