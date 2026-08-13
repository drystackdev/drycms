import { useEffect, useState } from "preact/hooks";
import dayjs from "dayjs";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import CodeBlock from "../components/CodeBlock.js";
import { useDialogSync } from "../hooks/list-nav.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";
import { CopyIcon, EyeIcon, PlusIcon, TrashIcon } from "../components/icons/index.js";
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

type McpClientId = "claude-desktop" | "claude-code" | "codex" | "gemini" | "other";

interface McpClientSnippet {
  id: McpClientId;
  label: string;
  blocks: { note: string; code: string }[];
}

/** Ready-to-paste connection commands/configs for the MCP clients this
 * project's users actually reach for - each just needs the freshly-minted
 * token and this server's own `/api/mcp` URL substituted in. Kept next to
 * `justCreated` below since the raw token only exists in memory for that one
 * render pass. */
function connectSnippets(mcpUrl: string, token: string): McpClientSnippet[] {
  return [
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      blocks: [
        {
          note: "Add to claude_desktop_config.json (Settings -> Developer -> Edit Config).",
          code: JSON.stringify(
            { mcpServers: { drycms: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
            null,
            2,
          ),
        },
      ],
    },
    {
      id: "claude-code",
      label: "Claude Code",
      blocks: [
        {
          note: "Run in a terminal - including Claude Code's own web terminal at claude.ai/code.",
          code: `claude mcp add --transport http drycms ${mcpUrl} --header "Authorization: Bearer ${token}"`,
        },
        {
          note: "Or commit this to the repo's .mcp.json so a Claude Code cloud session picks it up automatically.",
          code: JSON.stringify(
            { mcpServers: { drycms: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
            null,
            2,
          ),
        },
      ],
    },
    {
      id: "codex",
      label: "Codex CLI",
      blocks: [
        {
          note: "Set once, e.g. in your shell profile.",
          code: `export DRYCMS_MCP_TOKEN="${token}"`,
        },
        {
          note: "Add to ~/.codex/config.toml.",
          code: `[mcp_servers.drycms]\nurl = "${mcpUrl}"\nbearer_token_env_var = "DRYCMS_MCP_TOKEN"`,
        },
      ],
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      blocks: [
        {
          note: "Run in a terminal.",
          code: `gemini mcp add --transport http --header "Authorization: Bearer ${token}" drycms ${mcpUrl}`,
        },
      ],
    },
    {
      id: "other",
      label: "Other",
      blocks: [
        {
          note: "MCP server URL (Streamable HTTP transport).",
          code: mcpUrl,
        },
        {
          note: "Authorization header - required on every request.",
          code: `Authorization: Bearer ${token}`,
        },
      ],
    },
  ];
}

interface McpConnectDialogState {
  label: string;
  token: string;
}

/** The "copy this token" + "ready-to-paste connect command" UI. Only ever
 * opens once per token, right after `handleGenerate` mints it - that is the
 * single moment the raw value exists to show at all (`auth-security.ts`
 * persists just its hash, so nothing can reveal it again afterwards, which is
 * why a token's row carries no way to reopen this). A real `<dialog>` rather
 * than the inline `.alert` this used to be: `.alert`'s own CSS is a 2-column
 * icon+message grid (`components.css`), which was stretching every child -
 * the client tabs, the "Done" button - to fill a grid column meant for a
 * single line of text. Same native `<dialog>` + `useDialogSync` pattern as
 * `McpActivityDetailDialog` below. */
function McpConnectDialog({ state, onClose }: { state: McpConnectDialogState | null; onClose: () => void }) {
  const ref = useDialogSync(state !== null, onClose);
  // Deps include `state !== null`: the scroll body only mounts once the
  // dialog opens, so the ref is still null on first render - same reasoning
  // as `FieldDialog.tsx`'s own `gridScroll`.
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([state !== null]);
  const [client, setClient] = useState<McpClientId>("claude-desktop");

  const clients = state ? connectSnippets(`${window.location.origin}${path}/api/mcp`, state.token) : [];
  const active = clients.find((candidate) => candidate.id === client) ?? clients[0];

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.add({ type: "success", title: "Copied to clipboard." }),
      () => toast.add({ type: "error", title: "Could not copy to clipboard." }),
    );
  }

  return (
    <dialog ref={ref} class="lg mcp-connect-dialog" aria-label={state ? `Connect "${state.label}"` : "Connect an MCP client"}>
      {state && (
        <>
          <header>
            <h3>Copy this token now</h3>
            <p>It won't be shown again - save it somewhere safe.</p>
          </header>

          <div class="mcp-connect-dialog-scroll" ref={bodyScroll}>
            <div class="stack" style={{ gap: "0.5rem", marginBlockStart: "1rem" }}>
              <div>
                <small class="hint">Token</small>
                <CodeBlock code={state.token} copyable wrap />
              </div>
              <p class="hint" style={{ margin: "0.5rem 0 0" }}>Ready-to-paste connect command for:</p>
              <div class="button-group" style={{ alignSelf: "flex-start" }}>
                {clients.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    class="sm"
                    aria-pressed={active?.id === candidate.id}
                    onClick={() => setClient(candidate.id)}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
              {active?.blocks.map((block, index) => (
                <div key={index}>
                  <small class="hint">{block.note}</small>
                  <CodeBlock code={block.code} copyable wrap />
                </div>
              ))}
            </div>
          </div>

          <footer>
            <button type="button" onClick={onClose}>Done</button>
          </footer>
        </>
      )}
    </dialog>
  );
}

/** Self-contained "API Token" section - own fetch/state, no interaction with
 * anything else on this page. */
function McpTokensSection() {
  const [tokens, setTokens] = useState<McpTokenMeta[] | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [connectDialog, setConnectDialog] = useState<McpConnectDialogState | null>(null);
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
      setConnectDialog({ label: label.trim(), token: body.token });
      setLabel("");
    } catch (error) {
      toast.add({ type: "error", title: "Could not generate token", description: error instanceof Error ? error.message : undefined });
    } finally {
      setCreating(false);
    }
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
                    {/* Revoke only - there is deliberately no way to reopen
                        the connect dialog for an existing row: its raw token
                        is unrecoverable by then (`McpConnectDialog`), so the
                        button could only ever have shown a placeholder. */}
                    <button type="button" class="ghost icon sm" aria-label={`Revoke "${token.label}"`} onClick={() => setRevokeTarget(token)}>
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form class="row" style={{ gap: "0.5rem", alignItems: "flex-end", width: "100%" }} onSubmit={handleGenerate}>
              <TextField label="New token label" style={{flex: 1}} placeholder="e.g. Claude Desktop" value={label} onChange={setLabel} />
              <button type="submit" class="lg" disabled={!label.trim() || creating} aria-busy={creating || undefined}>
                <PlusIcon /> Generate
              </button>
            </form>
          </>
        )}
      </div>

      <McpConnectDialog state={connectDialog} onClose={() => setConnectDialog(null)} />

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
 * Own top-level route (`/dry/mcp`), reached from the sidebar account menu's
 * "MCP" item (`DryLayout.tsx`) and MagicChat's lock-icon shortcut - not in
 * `DryLayout`'s main `NAV` (same as Profile itself), since it's a secondary,
 * self-service destination rather than a permissioned admin section. Used to
 * be 2 sections bolted onto the bottom of `Profile.tsx`; split out into its
 * own full-width page instead.
 */
export default function McpConnect() {
  useDocumentTitle("MCP");

  return (
    <>
      <div class="page-header">
        <h1>MCP</h1>
        <p>Connect an external MCP client (Claude Desktop, Claude Code, ...) and review its activity.</p>
      </div>

      <McpTokensSection />
      <McpActivitySection />
    </>
  );
}
