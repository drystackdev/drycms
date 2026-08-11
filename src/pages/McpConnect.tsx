import { useEffect, useState } from "preact/hooks";
import dayjs from "dayjs";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import { useDialogSync } from "../hooks/list-nav.js";
import { ArrowLeftIcon, CopyIcon, EyeIcon, PlusIcon, TrashIcon } from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import TextField from "../components/fields/TextField.js";
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
 * anything else on this page. */
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
    <section class="card">
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

            <form class="row" style={{ gap: "0.5rem", alignItems: "flex-end" }} onSubmit={handleGenerate}>
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

interface McpActivityEntry {
  id: string;
  tool: string;
  summary: string;
  isError: boolean;
  timestamp: string;
}

const ACTIVITY_POLL_MS = 5_000;

/** Own small dialog rather than reusing `ConfirmDialog` - this one has no
 * confirm/cancel action, just a read-only view of a row's full `summary`
 * (the table cell truncates it to 1 line via CSS ellipsis). Same native
 * `<dialog>` + `useDialogSync` pattern as `RichTextPreviewDialog.tsx`. */
function McpActivityDetailDialog({ entry, onClose }: { entry: McpActivityEntry | null; onClose: () => void }) {
  const ref = useDialogSync(entry !== null, onClose);
  return (
    <dialog ref={ref} class="md" aria-label={entry ? `${entry.tool} activity` : "Activity detail"}>
      {entry && (
        <>
          <header>
            <h3>{entry.tool}</h3>
            <small class="hint">{dayjs(entry.timestamp).format("YYYY-MM-DD HH:mm:ss")}</small>
          </header>
          <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{entry.summary}</p>
          <footer>
            <button type="button" onClick={onClose}>Close</button>
          </footer>
        </>
      )}
    </dialog>
  );
}

/** `status/mcp-server.md` Phase 3 - mirrors the server's `routes/mcp.ts`
 * `McpActivityEntry` shape. Polled, not live: same "no cross-tab broadcast"
 * limitation Magic Chat itself already has, just made visible on a timer
 * instead of promised as instant. Rows render as a 2-column CSS grid (tool +
 * timestamp / content) instead of a plain flex list, so every row lines up
 * the same way a real table would - a flex row per item let a long tool
 * name's badge push that one row's content out of line with its neighbors. */
function McpActivitySection() {
  const [activity, setActivity] = useState<McpActivityEntry[] | null>(null);
  const [viewing, setViewing] = useState<McpActivityEntry | null>(null);

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
    <section class="card">
      <header>
        <h2>AI Activity (MCP)</h2>
        <p>The most recent tool calls an MCP client has made as you. Refreshes every few seconds.</p>
      </header>
      <div class="under">
        {activity === null ? (
          <span class="hint">Loading…</span>
        ) : activity.length === 0 ? (
          <span class="hint">No activity yet.</span>
        ) : (
          <ul class="mcp-activity-table">
            {activity.map((entry) => (
              <li key={entry.id} class="mcp-activity-row">
                <div class="mcp-activity-meta">
                  <span class={`badge sm ${entry.isError ? "destructive" : "info"}`} style={{ fontFamily: "monospace" }}>
                    {entry.tool}
                  </span>
                  <small class="hint">{dayjs(entry.timestamp).format("YYYY-MM-DD HH:mm:ss")}</small>
                </div>
                <div class="mcp-activity-content">
                  <span>{entry.summary}</span>
                  <button
                    type="button"
                    class="ghost icon sm"
                    aria-label={`View full activity for ${entry.tool}`}
                    data-tooltip="View"
                    onClick={() => setViewing(entry)}
                  >
                    <EyeIcon />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <McpActivityDetailDialog entry={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}

/**
 * Own top-level route (`/dry/mcp`), reached from Profile's "MCP" card and
 * MagicChat's lock-icon shortcut - not in `DryLayout`'s sidebar `NAV` (same
 * as Profile itself), since it's a secondary destination rather than a
 * primary one. Used to be 2 sections bolted onto the bottom of `Profile.tsx`;
 * split out into its own full-width page instead.
 */
export default function McpConnect() {
  useDocumentTitle("MCP");
  const { route } = useLocation();

  return (
    <>
      <div class="page-header">
        <button type="button" class="icon ghost" onClick={() => route(`${path}/profile`)}>
          <ArrowLeftIcon />
        </button>
        <div style={{ flex: 1 }}>
          <h1>MCP</h1>
          <p>Connect an external MCP client (Claude Desktop, Claude Code, ...) to this drycms instance, and review what it's done as you.</p>
        </div>
      </div>

      <McpTokensSection />
      <McpActivitySection />
    </>
  );
}
