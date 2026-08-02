import { useState } from "preact/hooks";
import Icon from "../components/Icon.js";
import PasswordField from "../components/PasswordField.js";
import TextField from "../components/TextField.js";
import { AuthApiError, registerFirstAdmin } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

/**
 * Rendered by `routers/App.tsx`'s `AuthGate` at `/register` whenever
 * `store/auth.ts`'s `authState` is `"needs-setup"` - i.e. the `user` table
 * is still empty (`GET /api/auth/session`'s `hasAnyUser: false`). This is
 * the only way to create the very first account; the created user is
 * assigned the seeded "Super Admin" role server-side (see `routes/auth.ts`).
 * Same split-panel layout as `SignIn` (`.auth-split*` in `components.css`),
 * deliberately kept visually consistent with it - just without the OAuth
 * row, which doesn't apply to a one-time account bootstrap.
 */
export default function RegisterSuperAdmin() {
  useDocumentTitle("Set up your admin account");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameError = submitAttempted && !name.trim() ? "Name is required." : undefined;
  const emailError = submitAttempted && !email.trim() ? "Email is required." : undefined;
  const passwordError = submitAttempted && !password ? "Password is required." : submitAttempted && password.length < 12 ? "Use at least 12 characters." : undefined;
  const confirmError =
    submitAttempted && password && confirmPassword !== password ? "Passwords do not match." : undefined;

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    if (!name.trim() || !email.trim() || password.length < 12 || confirmPassword !== password || !bootstrapToken) return;

    setSubmitting(true);
    try {
      await registerFirstAdmin(name.trim(), email.trim(), password, bootstrapToken);
    } catch (error) {
      setSubmitError(error instanceof AuthApiError ? error.message : "Failed to create the account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="auth-split">
      <div class="auth-split-form">
        <div class="auth-split-brand">
          <Icon name="Brand" />
          <span>DRYCMS</span>
        </div>

        <div class="auth-split-center">
          <form onSubmit={handleSubmit}>
            <header>
              <h1>Set up your admin account</h1>
              <p>No account exists yet - create the first one to get started. It's granted the Super Admin role.</p>
            </header>

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
            <PasswordField
              label="Bootstrap token"
              name="bootstrapToken"
              placeholder="DRYCMS_BOOTSTRAP_TOKEN"
              value={bootstrapToken}
              onChange={setBootstrapToken}
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
        </div>
      </div>

      <div class="auth-split-panel">
        <Icon name="Brand" />
      </div>
    </div>
  );
}
