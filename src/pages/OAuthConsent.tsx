import { useEffect, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import Icon from "../components/Icon.js";
import { authState } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

interface ConsentInfo {
  clientName: string;
  redirectUriHost: string;
}

/**
 * `status/mcp-oauth.md` - the OAuth consent screen an MCP client (claude.ai
 * web's "custom connector" flow) lands on after `routes/oauth.ts`'s
 * `/authorize` validates the request, minting a short-lived `request_id`
 * (and, if the visitor wasn't signed in yet, bouncing them through `/login`
 * first via `routers/App.tsx`'s `AuthGate` `?return_to=` support). Rendered
 * directly by `AuthGate` (like `SignIn`/`RegisterSuperAdmin`), NOT inside
 * `AuthenticatedApp`/`DryLayout` - a one-off consent action has no business
 * inside the dashboard chrome, and this is only ever reached authenticated
 * (`AuthGate` gates it), so `authState.value.user` is always populated here.
 * Errors surface inline (not via `toast.add` - `Toaster` only mounts inside
 * `DryLayout`, which this page deliberately skips). Approve/Deny both end by
 * handing this page a `redirect` URL back to the requesting client's own
 * `redirect_uri` - this page never talks to that client directly, only to
 * this server's own `.../api/oauth/consent[-info]`.
 */
export default function OAuthConsent() {
  useDocumentTitle("Connect");

  const requestId = new URLSearchParams(window.location.search).get("request_id") ?? "";
  const [info, setInfo] = useState<ConsentInfo | null | "error">(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!requestId) {
      setInfo("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${path}/api/oauth/consent-info?request_id=${encodeURIComponent(requestId)}`);
        if (!response.ok) throw new Error("consent-info failed");
        const body = (await response.json()) as ConsentInfo;
        if (!cancelled) setInfo(body);
      } catch {
        if (!cancelled) setInfo("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  async function respond(approve: boolean) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // `installCsrfFetch()` (`lib/native/native.ts`) already patches global
      // `fetch` to attach the CSRF header - nothing extra needed here.
      const response = await fetch(`${path}/api/oauth/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, approve }),
      });
      const body = (await response.json().catch(() => ({}))) as { redirect?: string; message?: string };
      if (!response.ok || !body.redirect) {
        setSubmitError(body.message ?? "Something went wrong. Please try connecting again.");
        setSubmitting(false);
        return;
      }
      window.location.href = body.redirect;
    } catch {
      setSubmitError("Something went wrong. Please try connecting again.");
      setSubmitting(false);
    }
  }

  return (
    <div class="oauth-consent-screen">
      <div class="card oauth-consent-card">
        <div class="auth-split-brand">
          <Icon name="Brand" />
          <span>DRYCMS</span>
        </div>

        {info === null && <span class="hint">Loading…</span>}

        {info === "error" && (
          <div class="alert destructive">
            <p>This connection request has expired or is invalid. Please try connecting again from the application.</p>
          </div>
        )}

        {info && info !== "error" && (
          <>
            <header>
              <h1>{info.clientName}</h1>
              <p>
                wants to access your drycms account as <strong>{authState.value.user?.email}</strong>, and will
                redirect you to <strong>{info.redirectUriHost}</strong> once you decide.
              </p>
            </header>

            {submitError && (
              <div class="alert destructive">
                <p>{submitError}</p>
              </div>
            )}

            <div class="oauth-consent-actions">
              <button type="button" disabled={submitting} aria-busy={submitting || undefined} onClick={() => respond(true)}>
                Approve
              </button>
              <button type="button" class="outline" disabled={submitting} onClick={() => respond(false)}>
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
