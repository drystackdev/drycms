import type { JSX } from "preact/jsx-runtime";
import PasswordField from "../../components/fields/PasswordField.js";
import type { MaskedValue } from "../../content-types/engine/entry-codec.js";
import { passwordConfirmError } from "../../content-types/engine/entry-validate.js";

export interface PasswordChangeFieldProps {
  label: string;
  description?: string;
  value: MaskedValue;
  onChange: (value: MaskedValue) => void;
  required?: boolean;
  /** Server- (or gate-) sourced `required` violation, create mode only - belongs under
   * "Password". Confirm-mismatch is computed live from `value` instead, independent of this. */
  error?: string;
  disabled?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

/**
 * Composite editor for a `password`-type field: create mode (no existing value yet)
 * renders "Password" + "Confirm password"; edit mode relabels them "New password" +
 * "Confirm new password". This is the admin content-entry editor - it can already write
 * any field on the row, so setting a new password (an admin-triggered reset) doesn't
 * require the current one; that stays a login-only credential, never re-collected here.
 * Each input is a plain `PasswordField`, so both share that component's page-wide reveal
 * toggle (`store/field-visibility.ts`); revealing one reveals the other, by design, not a bug.
 */
export default function PasswordChangeField({
  label,
  description,
  value,
  onChange,
  required = false,
  error,
  disabled = false,
  class: className,
  style,
}: PasswordChangeFieldProps) {
  const confirmError = passwordConfirmError(value);

  return (
    <fieldset class={className} style={style}>
      <legend>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </legend>
      {description && <small>{description}</small>}
      <div class="stack">
        <PasswordField
          label={value.hasExisting ? "New password" : "Password"}
          value={value.new ?? ""}
          onChange={(next) => onChange({ ...value, new: next })}
          placeholder={value.hasExisting ? "Leave blank to keep the current password" : "Enter a password"}
          disabled={disabled}
          error={!value.hasExisting && !!error}
          helperText={!value.hasExisting ? error : undefined}
        />
        <PasswordField
          label={value.hasExisting ? "Confirm new password" : "Confirm password"}
          value={value.confirm ?? ""}
          onChange={(confirm) => onChange({ ...value, confirm })}
          placeholder="Re-enter the password"
          disabled={disabled}
          error={!!confirmError}
          helperText={confirmError}
        />
      </div>
    </fieldset>
  );
}
