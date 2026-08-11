import dayjs from "dayjs";
import Popover from "./Popover.js";
import { LockIcon } from "./icons/index.js";
import { mcpActivity, mcpActivityUnseen, markMcpActivitySeen } from "../store/mcp-activity.js";

const { path } = window.__DRY_CONFIG__;

/** Most recent entries shown in the dropdown itself - the full 50-entry log
 * still lives at Profile → AI Activity, linked below. */
const PREVIEW_COUNT = 8;

/**
 * Topbar bell-equivalent for MCP tool-call activity (`status/mcp-server.md`
 * Phase 3 originally only surfaced this on Profile, polled while that one
 * page was open). Mounted once in `DryLayout` (never unmounts), so a red dot
 * lights up on this trigger from anywhere in the admin the moment an MCP
 * client does something as the signed-in user - not just when they happen to
 * have Profile open. Reads the same shared poll (`store/mcp-activity.ts`)
 * Profile's `McpActivitySection` does, so the two lists never disagree.
 */
export default function McpActivityIndicator() {
  const activity = mcpActivity.value;
  const unseen = mcpActivityUnseen.value;

  return (
    <Popover
      label="AI activity (MCP)"
      tooltip="AI activity (MCP)"
      trigger={(onClick, open) => (
        <button
          type="button"
          class="icon ghost mcp-activity-trigger"
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={unseen > 0 ? `AI activity (MCP) - ${unseen} new` : "AI activity (MCP)"}
          data-tooltip="AI activity (MCP)"
          onClick={(event) => {
            const wasClosed = !open;
            onClick(event);
            if (wasClosed) markMcpActivitySeen();
          }}
        >
          <LockIcon />
          {unseen > 0 && <span class="mcp-activity-dot" aria-hidden="true" />}
        </button>
      )}
    >
      <li role="none" class="mcp-activity-panel">
        <header class="mcp-activity-panel-head">
          <strong>AI Activity (MCP)</strong>
          <a href={`${path}/mcp`}>View all</a>
        </header>
        {activity.length === 0 ? (
          <p class="hint">No activity yet.</p>
        ) : (
          <ul class="mcp-activity-list">
            {activity.slice(0, PREVIEW_COUNT).map((entry) => (
              <li key={entry.id}>
                <span class={`badge sm ${entry.isError ? "destructive" : "info"}`}>{entry.tool}</span>
                <div>
                  <div>{entry.summary}</div>
                  <small class="hint">{dayjs(entry.timestamp).format("YYYY-MM-DD HH:mm:ss")}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    </Popover>
  );
}
