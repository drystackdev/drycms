import { useEffect, useMemo, useState } from "preact/hooks";
import dayjs from "dayjs";
const { path } = window.__DRY_CONFIG__;
import type { MaskedValue } from "../content-types/engine/entry-codec.js";
import { passwordConfirmError } from "../content-types/engine/entry-validate.js";
import AvatarField, { commitPendingAvatar, isPendingAvatarValue } from "../components/fields/AvatarField.js";
import PasswordField from "../components/fields/PasswordField.js";
import TextField from "../components/fields/TextField.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { CopyIcon, PlusIcon, TrashIcon } from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import { createHttpFileSource } from "../storage/http-source.js";
import { AuthApiError, authState, updateProfile } from "../store/auth.js";
import PasswordChangeField from "./content-entry-editor/PasswordChangeField.js";
import { useDocumentTitle } from "./page-common.js";

/** `status/mcp-server.md` - a Personal Access Token an MCP client (Claude
 * Desktop, Claude Code, ...) authenticates with, in place of the browser's
 * own session cookie. Mirrors the server's `auth-security.ts`'s
 * `McpTokenMeta` shape exactly - a separate client-only copy (like every
 * other page's own response-shape interface here) rather than importing a
 * server module into browser code. */
interface McpTokenMeta {
  tokenId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
}

/** Self-contained "API Token" section - own fetch/state, no interaction with
 * the profile form above it (revoking/generating a token isn't part of the
 * "Save changes" submit). */
function McpTokensSection() {
  const [tokens, setTokens] = useState<McpTokenMeta[] | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<McpTokenMeta | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${path}/api/auth/mcp-tokens`, { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { tokens?: McpTokenMeta[] };
        setTokens(body.tokens ?? []);
      } catch {
        setTokens([]);
      }
    })();
  }, []);

  async function handleGenerate(event: Event) {
    event.preventDefault();
    if (!label.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${path}/api/auth/mcp-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ label: label.trim() }),
      });
      const body = (await res.json()) as { tokenId?: string; token?: string; message?: string };
      if (!res.ok || !body.tokenId || !body.token) throw new Error(body.message ?? "Failed to generate token.");
      setTokens((current) => [...(current ?? []), { tokenId: body.tokenId!, label: label.trim(), createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() }]);
      setJustCreated(body.token);
      setLabel("");
    } catch (error) {
      toast.add({ type: "error", title: "Could not generate token", description: error instanceof Error ? error.message : undefined });
    } finally {
      setCreating(false);
    }
  }

  function handleCopy(token: string) {
    navigator.clipboard.writeText(token).then(
      () => toast.add({ type: "success", title: "Copied to clipboard." }),
      () => toast.add({ type: "error", title: "Could not copy to clipboard." }),
    );
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await fetch(`${path}/api/auth/mcp-tokens/${encodeURIComponent(revokeTarget.tokenId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      setTokens((current) => (current ?? []).filter((token) => token.tokenId !== revokeTarget.tokenId));
      toast.add({ type: "success", title: "Token revoked." });
    } catch (error) {
      toast.add({ type: "error", title: "Could not revoke token", description: error instanceof Error ? error.message : undefined });
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  }

  return (
    <section class="card" style={{ maxWidth: "28rem" }}>
      <header>
        <h2>API Token</h2>
        <p>Lets an MCP client (Claude Desktop, Claude Code, ...) connect to this drycms instance as you.</p>
      </header>
      <div class="under stack">
        {justCreated && (
          <div class="alert" style={{ wordBreak: "break-all" }}>
            <p>Copy this token now - it won't be shown again.</p>
            <div class="row align-center" style={{ gap: "0.375rem" }}>
              <code style={{ flex: 1 }}>{justCreated}</code>
              <button type="button" class="ghost icon sm" aria-label="Copy token" onClick={() => handleCopy(justCreated)}>
                <CopyIcon />
              </button>
            </div>
            <button type="button" class="ghost sm" onClick={() => setJustCreated(null)}>Done</button>
          </div>
        )}

        {tokens === null ? (
          <span class="hint">Loading…</span>
        ) : (
          <>
            {tokens.length === 0 ? (
              <span class="hint">No tokens yet.</span>
            ) : (
              <ul class="stack" style={{ gap: "0.375rem", listStyle: "none", padding: 0, margin: 0 }}>
                {tokens.map((token) => (
                  <li key={token.tokenId} class="row justify-between align-center">
                    <div>
                      <div>{token.label}</div>
                      <small class="hint">Created {dayjs(token.createdAt).format("YYYY-MM-DD")} · Last used {dayjs(token.lastUsedAt).format("YYYY-MM-DD HH:mm")}</small>
                    </div>
                    <button type="button" class="ghost icon sm" aria-label={`Revoke "${token.label}"`} onClick={() => setRevokeTarget(token)}>
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form class="row" style={{ gap: "0.5rem" }} onSubmit={handleGenerate}>
              <TextField label="New token label" placeholder="e.g. Claude Desktop" value={label} onChange={setLabel} />
              <button type="submit" disabled={!label.trim() || creating} aria-busy={creating || undefined}>
                <PlusIcon /> Generate
              </button>
            </form>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke this token?"
        message={<p>Any MCP client using "{revokeTarget?.label}" will immediately stop being able to connect.</p>}
        confirmLabel="Revoke"
        destructive
        busy={revoking}
        onConfirm={() => void handleRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </section>
  );
}

/** `status/mcp-server.md` Phase 3 - mirrors the server's `routes/mcp.ts`
 * `McpActivityEntry` shape. Polled, not live: same "no cross-tab broadcast"
 * limitation Magic Chat itself already has, just made visible on a timer
 * instead of promised as instant. */
interface McpActivityEntry {
  id: string;
  tool: string;
  summary: string;
  isError: boolean;
  timestamp: string;
}

const ACTIVITY_POLL_MS = 5_000;

function McpActivitySection() {
  const [activity, setActivity] = useState<McpActivityEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${path}/api/mcp/activity`, { credentials: "same-origin" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { activity?: McpActivityEntry[] };
        if (!cancelled) setActivity(body.activity ?? []);
      } catch {
        // Leave the previous list showing - a transient poll failure isn't worth surfacing.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), ACTIVITY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section class="card" style={{ maxWidth: "28rem" }}>
      <header>
        <h2>AI Activity (MCP)</h2>
        <p>The most recent tool calls an MCP client has made as you. Refreshes every few seconds.</p>
      </header>
      <div class="under stack">
        {activity === null ? (
          <span class="hint">Loading…</span>
        ) : activity.length === 0 ? (
          <span class="hint">No activity yet.</span>
        ) : (
          <ul class="stack" style={{ gap: "0.5rem", listStyle: "none", padding: 0, margin: 0 }}>
            {activity.map((entry) => (
              <li key={entry.id} class="row" style={{ gap: "0.5rem", alignItems: "flex-start" }}>
                <span class={`badge sm ${entry.isError ? "destructive" : "info"}`} style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {entry.tool}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{entry.summary}</div>
                  <small class="hint">{dayjs(entry.timestamp).format("YYYY-MM-DD HH:mm:ss")}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Self-service account editor, reached from `DryLayout`'s sidebar account
 * menu ("Profile") - a standalone page (own route, own back-less header),
 * not a dialog. Only `name`/`email`/`avatar`/password are editable here; role
 * assignment stays admin-only (`pages/RoleEditor.tsx`) - the current roles
 * are shown read-only for context. Reuses `PasswordChangeField` (built for
 * the admin entry editor) for the new/confirm pair, plus a separate "Current
 * password" field this page owns itself - unlike the admin editor (which can
 * already write any field on any row), a SELF-service password change must
 * re-prove identity, so the server requires and verifies it.
 */
export default function Profile() {
  useDocumentTitle("My profile");

  const imageSource = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);
  const user = authState.value.user;
  const [name, setName] = useState(user?.name ?? "");
  const [avatar, setAvatar] = useState(user?.avatar ?? "");
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
      // Uploaded here, right before the request actually goes out, not on
      // pick - see `AvatarField.tsx`'s own doc comment.
      const committedAvatar = isPendingAvatarValue(avatar)
        ? await commitPendingAvatar(imageSource, avatar, user!.id)
        : avatar;
      await updateProfile(name.trim(), email.trim(), committedAvatar, currentPassword, password.new ?? "");
      setAvatar(committedAvatar);
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
          <p>Update your account's name, avatar, email, and password.</p>
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
        <AvatarField label="Avatar" value={avatar} onChange={setAvatar} />
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

      <McpTokensSection />
      <McpActivitySection />
    </>
  );
}
