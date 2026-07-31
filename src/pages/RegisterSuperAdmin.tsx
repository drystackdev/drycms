import { useState } from "preact/hooks";
import Icon from "../components/Icon.js";
import PasswordField from "../components/PasswordField.js";
import TextField from "../components/TextField.js";
import { AuthApiError, registerFirstAdmin } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

/**
 * Rendered by `routers/App.tsx`'s `AuthGate` in place of the whole admin
 * shell whenever `store/auth.ts`'s `authState` is `"needs-setup"` - i.e. the
 * `user` table is still empty (`GET /api/auth/session`'s `hasAnyUser:
 * false`). This is the only way to create the very first account; the
 * created user is assigned the seeded "Super Admin" role server-side (see
 * `routes/auth.ts`).
 */
export default function RegisterSuperAdmin() {
  useDocumentTitle("Set up your admin account");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameError = submitAttempted && !name.trim() ? "Name is required." : undefined;
  const emailError = submitAttempted && !email.trim() ? "Email is required." : undefined;
  const passwordError = submitAttempted && !password ? "Password is required." : undefined;
  const confirmError =
    submitAttempted && password && confirmPassword !== password ? "Passwords do not match." : undefined;

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    if (!name.trim() || !email.trim() || !password || confirmPassword !== password) return;

    setSubmitting(true);
    try {
      await registerFirstAdmin(name.trim(), email.trim(), password);
    } catch (error) {
      setSubmitError(error instanceof AuthApiError ? error.message : "Failed to create the account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-brand">
          <Icon name="Brand" />
          <span>DRYCMS</span>
        </div>

        <article class="card">
          <header>
            <h2>Set up your admin account</h2>
            <p>No account exists yet - create the first one to get started. It's granted the Super Admin role.</p>
          </header>

          <form onSubmit={handleSubmit}>
            <TextField
              label="Name"
              name="name"
              placeholder="e.g. Ada Lovelace"
              value={name}
              onChange={setName}
              error={!!nameError}
              helperText={nameError}
              required
            />
            <TextField
              label="Email"
              name="email"
              placeholder="e.g. ada@example.com"
              value={email}
              onChange={setEmail}
              error={!!emailError}
              helperText={emailError}
              required
            />
            <PasswordField
              label="Password"
              name="password"
              placeholder="Choose a password"
              value={password}
              onChange={setPassword}
              error={!!passwordError}
              helperText={passwordError}
              required
            />
            <PasswordField
              label="Confirm password"
              name="confirmPassword"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              error={!!confirmError}
              helperText={confirmError}
              required
            />

            {submitError && (
              <div class="alert destructive">
                <p>{submitError}</p>
              </div>
            )}

            <button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              Create Super Admin account
            </button>
          </form>
        </article>
      </div>
    </div>
  );
}
