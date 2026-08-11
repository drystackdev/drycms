import { signal } from "@preact/signals";

const { path } = window.__DRY_CONFIG__;

/** Mirrors `routes/mcp.ts`'s `McpActivityEntry` - the last 50 MCP tool calls
 * made as the signed-in user, newest first. */
export interface McpActivityEntry {
  id: string;
  tool: string;
  summary: string;
  isError: boolean;
  timestamp: string;
}

const POLL_MS = 5_000;

/** App-wide MCP activity list, one poll shared by every consumer (the topbar
 * `McpActivityIndicator` and Profile's `McpActivitySection`) instead of each
 * running its own `setInterval` - `DryLayout` never remounts, so starting
 * this once from there covers the whole session. */
export const mcpActivity = signal<McpActivityEntry[]>([]);

/** Count of entries newer than the last time a consumer called
 * `markMcpActivitySeen()` - drives the topbar's red dot. Deliberately stays
 * `0` for the very first poll of a session (see `poll()` below): nobody's
 * MCP history from before this tab was open counts as "just happened". */
export const mcpActivityUnseen = signal(0);

let lastSeenId: string | undefined;
let baselined = false;
let started = false;

export function markMcpActivitySeen(): void {
  lastSeenId = mcpActivity.value[0]?.id;
  mcpActivityUnseen.value = 0;
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${path}/api/mcp/activity`, { credentials: "same-origin" });
    if (!res.ok) return;
    const body = (await res.json()) as { activity?: McpActivityEntry[] };
    const activity = body.activity ?? [];
    mcpActivity.value = activity;

    if (!baselined) {
      baselined = true;
      lastSeenId = activity[0]?.id;
      return;
    }
    const seenIndex = activity.findIndex((entry) => entry.id === lastSeenId);
    mcpActivityUnseen.value = seenIndex === -1 ? activity.length : seenIndex;
  } catch {
    // Transient poll failure - keep showing the last known list/count.
  }
}

/** Starts the shared poll, once per page load. Safe to call from more than
 * one mount site - only the first call does anything. */
export function startMcpActivityPoll(): void {
  if (started) return;
  started = true;
  void poll();
  window.setInterval(() => void poll(), POLL_MS);
}
