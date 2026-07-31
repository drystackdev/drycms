import { useState } from "preact/hooks";
import Icon from "../components/Icon.js";
import PasswordField from "../components/PasswordField.js";
import TextField from "../components/TextField.js";
import { AuthApiError, login } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

/** Inline brand marks for the not-yet-wired OAuth buttons below - one-off
 * third-party logos, deliberately not added to `components/icons.tsx`'s
 * curated registry (that's for this app's OWN icon set, sanitized/managed
 * through Icon Management - these are fixed brand marks used nowhere else). */
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5C5.73.5.98 5.24.98 11.52c0 4.94 3.2 9.13 7.65 10.6.56.1.76-.24.76-.54v-1.9c-3.11.68-3.77-1.5-3.77-1.5-.5-1.28-1.24-1.62-1.24-1.62-1.02-.7.08-.69.08-.69 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.62 1.21 3.26.93.1-.72.39-1.21.71-1.49-2.48-.28-5.1-1.24-5.1-5.53 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .93-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.12-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.3-2.63 5.24-5.13 5.52.4.35.76 1.03.76 2.08v3.08c0 .3.2.65.77.54A11.03 11.03 0 0 0 23 11.52C23 5.24 18.27.5 12 .5Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M16.36 1.43c.1 1.02-.28 2.02-.9 2.77-.63.76-1.66 1.35-2.67 1.27-.12-.98.32-2 .92-2.7.66-.78 1.8-1.36 2.65-1.34ZM20.9 17.1c-.32.75-.7 1.46-1.15 2.12-.62.9-1.13 1.53-1.52 1.87-.6.56-1.25.85-1.94.86-.5 0-1.1-.14-1.79-.43-.7-.29-1.34-.43-1.93-.43-.62 0-1.28.14-1.98.43-.7.3-1.27.45-1.7.46-.66.03-1.32-.27-1.98-.9-.42-.37-.96-1.02-1.6-1.95-.7-1-1.27-2.16-1.72-3.49-.48-1.44-.72-2.83-.72-4.17 0-1.53.33-2.85.99-3.96a5.83 5.83 0 0 1 2.08-2.11 5.6 5.6 0 0 1 2.82-.8c.53 0 1.24.16 2.13.48.88.32 1.45.48 1.7.48.19 0 .82-.19 1.9-.56.99-.34 1.83-.48 2.51-.43 1.86.15 3.26.88 4.19 2.2-1.66 1.01-2.49 2.42-2.47 4.24.02 1.42.53 2.6 1.53 3.55.45.44.96.78 1.53 1.02-.12.35-.25.7-.4 1.05Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

/**
 * Rendered by `routers/App.tsx`'s `AuthGate` in place of the whole admin
 * shell whenever `store/auth.ts`'s `authState` is `"anonymous"` - standalone,
 * no `DryLayout` sidebar/topbar (there's no one signed in to show them to
 * yet). Split-panel layout (form left, decorative panel right) - see
 * `.auth-split*` in `components.css`; `RegisterSuperAdmin` keeps the
 * separate single-card `.auth-page`/`.auth-card` layout.
 */
export default function SignIn() {
  useDocumentTitle("Sign in");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailError = submitAttempted && !email.trim() ? "Email is required." : undefined;
  const passwordError = submitAttempted && !password ? "Password is required." : undefined;

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    if (!email.trim() || !password) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (error) {
      setSubmitError(error instanceof AuthApiError ? error.message : "Failed to sign in.");
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
              <h1>Login to your account</h1>
              <p>Enter your email below to login to your account</p>
            </header>

            <TextField
              label="Email"
              name="email"
              placeholder="m@example.com"
              value={email}
              onChange={setEmail}
              error={!!emailError}
              helperText={emailError}
              required
            />

            <PasswordField
              label="Password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
              error={!!passwordError}
              helperText={passwordError}
              labelAction={
                // Not wired up yet - no password-reset flow exists.
                <a href="#" data-tooltip="Coming soon" onClick={(event) => event.preventDefault()}>
                  Forgot your password?
                </a>
              }
            />

            {submitError && (
              <div class="alert destructive">
                <p>{submitError}</p>
              </div>
            )}

            <button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              Login
            </button>

            <div class="auth-divider">Or continue with</div>

            <button type="button" class="outline" disabled data-tooltip="Coming soon">
              <GitHubIcon />
              Login with GitHub
            </button>
            <button type="button" class="outline" disabled data-tooltip="Coming soon">
              <MailIcon />
              Login with email link
            </button>
            <button type="button" class="outline" disabled data-tooltip="Coming soon">
              <AppleIcon />
              Login with Apple
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
