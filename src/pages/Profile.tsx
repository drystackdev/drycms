import { useState } from "preact/hooks";
import type { MaskedValue } from "../content-types/engine/entry-codec.js";
import { passwordConfirmError } from "../content-types/engine/entry-validate.js";
import PasswordField from "../components/PasswordField.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import { AuthApiError, authState, updateProfile } from "../store/auth.js";
import PasswordChangeField from "./content-entry-editor/PasswordChangeField.js";
import { useDocumentTitle } from "./page-common.js";

/**
 * Self-service account editor, reached from `DryLayout`'s sidebar account
 * menu ("Profile") - a standalone page (own route, own back-less header),
 * not a dialog. Only `name`/`email`/password are editable here; role
 * assignment stays admin-only (`pages/RoleEditor.tsx`) - the current roles
 * are shown read-only for context. Reuses `PasswordChangeField` (built for
 * the admin entry editor) for the new/confirm pair, plus a separate "Current
 * password" field this page owns itself - unlike the admin editor (which can
 * already write any field on any row), a SELF-service password change must
 * re-prove identity, so the server requires and verifies it.
 */
export default function Profile() {
  useDocumentTitle("My profile");

  const user = authState.value.user;
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState<MaskedValue>({ hasExisting: true });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameError = fieldErrors.name ?? (submitAttempted && !name.trim() ? "Name is required." : undefined);
  const emailError = fieldErrors.email ?? (submitAttempted && !email.trim() ? "Email is required." : undefined);
  const confirmError = passwordConfirmError(password);
  // Changing the password requires all 3 fields together - current, new, and
  // confirm - leaving all 3 blank just updates name/email and skips the
  // password entirely (see `routes/auth.ts`'s `update-profile`).
  const isChangingPassword = !!(currentPassword || password.new || password.confirm);
  const incompletePasswordChange = isChangingPassword && (!currentPassword || !password.new || !password.confirm);
  const currentPasswordError =
    fieldErrors.currentPassword ??
    (submitAttempted && isChangingPassword && !currentPassword ? "Enter your current password." : undefined);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    setFieldErrors({});
    if (!name.trim() || !email.trim() || confirmError || incompletePasswordChange) return;

    setSubmitting(true);
    try {
      await updateProfile(name.trim(), email.trim(), currentPassword, password.new ?? "");
      setCurrentPassword("");
      setPassword({ hasExisting: true });
      setSubmitAttempted(false);
      toast.add({ type: "success", title: "Profile updated." });
    } catch (error) {
      if (error instanceof AuthApiError && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
      }
      setSubmitError(error instanceof Error ? error.message : "Failed to update profile.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>My profile</h1>
          <p>Update your account's name, email, and password.</p>
        </div>
      </div>

      <form class="stack" style={{ maxWidth: "28rem" }} onSubmit={handleSubmit}>
        <TextField
          label="Name"
          placeholder="e.g. Ada Lovelace"
          value={name}
          onChange={setName}
          error={!!nameError}
          helperText={nameError}
          required
        />
        <TextField
          label="Email"
          placeholder="e.g. ada@example.com"
          value={email}
          onChange={setEmail}
          error={!!emailError}
          helperText={emailError}
          required
        />

        <div class="field">
          <label>Roles</label>
          <div class="row" style={{ flexWrap: "wrap", gap: "0.375rem" }}>
            {user.roles.length === 0 ? (
              <span class="hint">No roles assigned.</span>
            ) : (
              user.roles.map((role) => (
                <span key={role} class="badge sm info">
                  {role}
                </span>
              ))
            )}
          </div>
        </div>

        <PasswordField
          label="Current password"
          placeholder="Required to set a new password"
          value={currentPassword}
          onChange={setCurrentPassword}
          error={!!currentPasswordError}
          helperText={currentPasswordError}
          autoComplete="current-password"
        />
        <PasswordChangeField label="Password" value={password} onChange={setPassword} />
        {submitAttempted && incompletePasswordChange && !currentPasswordError && (
          <span class="error">Fill in current, new, and confirm password to change it - or leave all 3 blank.</span>
        )}

        {submitError && (
          <div class="alert destructive">
            <p>{submitError}</p>
          </div>
        )}

        <button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
          Save changes
        </button>
      </form>
    </>
  );
}
