import type { JSX } from "preact/jsx-runtime";
import PasswordField from "../../components/PasswordField.js";
import type { MaskedValue } from "../../content-types/engine/entry-codec.js";
import { passwordConfirmError, passwordOldRequiredError } from "../../content-types/engine/entry-validate.js";

export interface PasswordChangeFieldProps {
  label: string;
  description?: string;
  value: MaskedValue;
  onChange: (value: MaskedValue) => void;
  required?: boolean;
  /** Server- (or gate-) sourced error - "Current password is incorrect." in edit mode,
   * a `required` violation in create mode. Shown under whichever single input that
   * message can actually be about (see doc comment below); confirm-mismatch and
   * missing-old-password are computed live from `value` instead, independent of this. */
  error?: string;
  disabled?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

/**
 * Composite editor for a `password`-type field: create mode ("no existing value yet)
 * renders "Password" + "Confirm password"; edit mode adds a "Current password" input
 * ahead of them, required to change the value - verified server-side against the
 * stored hash (`entry-codec.ts`'s `verifyPasswordChanges`) rather than trusted blindly.
 * Each input is a plain `PasswordField`, so all of them - including these 2-3 siblings -
 * share that component's page-wide reveal toggle (`store/field-visibility.ts`);
 * revealing one reveals the rest, by design, not a bug.
 *
 * The two modes are mutually exclusive by construction (`entry-validate.ts`'s
 * `isEmptyValue` never flags an edit-mode password as empty), so the single incoming
 * `error` string is unambiguous: in create mode it's a `required` violation and belongs
 * under "Password"; in edit mode it can only be "Current password is incorrect." from
 * `verifyPasswordChanges`, so it belongs under "Current password".
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
  const oldError = passwordOldRequiredError(value);
  const confirmError = passwordConfirmError(value);

  return (
    <fieldset class={className} style={style}>
      <legend>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </legend>
      {description && <small>{description}</small>}
      <div class="stack">
        {value.hasExisting && (
          <PasswordField
            label="Current password"
            value={value.old ?? ""}
            onChange={(old) => onChange({ ...value, old })}
            placeholder="Enter the current password"
            disabled={disabled}
            error={!!error || !!oldError}
            helperText={error ?? oldError}
          />
        )}
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
