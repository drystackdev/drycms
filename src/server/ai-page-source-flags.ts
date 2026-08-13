/**
 * Server-side "AI overwrote this file, nobody's built it since" tracker for
 * page-source files - the write-side counterpart to MCP's `write_page_source`
 * tool (`routes/mcp.ts`'s `runWritePageSourceTool`). That tool writes
 * DIRECTLY to `pagesSourceStorage` (unlike `propose_content_type`, there's no
 * draft/review step - see that tool's own doc comment), and outside of a
 * live dev-server/VEI session, nothing reaches a real site visitor until a
 * human explicitly Builds/Publishes. Until this existed, an MCP-authored
 * change to a `page.tsx` was invisible everywhere: the Page Editor's own
 * "needs build" dot (`PageEditor.tsx`'s `unbuiltPaths`) is `sessionStorage`,
 * populated only by THAT tab's own Save button - an MCP write from outside
 * any browser session never touched it.
 *
 * Global (not per-user, unlike `ai-content-type-drafts.ts`'s pending-review
 * queue): a published page is shared site state, not one admin's personal
 * draft awaiting THEIR review - every admin with Page Builder access should
 * see the same flag. Scoped to `page.tsx` paths only, mirroring
 * `PageEditor.tsx`'s own `markUnbuilt()` - the same file class that dot
 * already tracks, since only a route-entry file has an unambiguous "which
 * build event clears this" answer (see `routes/pages-build.ts`'s
 * `publishOne`, which is the only place this ever gets cleared).
 */
import { getAuthSecurityStore } from "./auth-security.js";

const NAMESPACE = "ai-page-source-flags";
const KEY = "global";

const PAGE_ENTRY_RE = /(^|\/)page\.tsx$/;

export interface AiPageSourceFlag {
  path: string;
  writtenAt: string;
}

/** Same "wrap the list with a bump-on-write counter" shape
 * `ai-content-type-drafts.ts`'s `AiContentTypeDraftIndex`/`mcp.ts`'s
 * `McpActivityLog` use, for the identical reason: the Page Editor polls this
 * while open, almost always with nothing new since the last tick. */
interface AiPageSourceFlagLog {
  version: number;
  entries: AiPageSourceFlag[];
}

async function readLog(env: Record<string, unknown>): Promise<AiPageSourceFlagLog> {
  return (await getAuthSecurityStore(env).get<AiPageSourceFlagLog>(NAMESPACE, KEY)) ?? { version: 0, entries: [] };
}

/** Called once, right after `write_page_source` successfully overwrites
 * `path` - a no-op for anything other than a `page.tsx` (see this module's
 * own doc comment on scope). Re-flagging an already-flagged path still
 * bumps the version and refreshes `writtenAt` (a second AI write before
 * anyone rebuilt is still real, newer information). */
export async function markAiPageSourceWrite(path: string, env: Record<string, unknown> = {}): Promise<void> {
  if (!PAGE_ENTRY_RE.test(path)) return;
  const store = getAuthSecurityStore(env);
  const current = await readLog(env);
  const withoutThisPath = current.entries.filter((entry) => entry.path !== path);
  const entries = [{ path, writtenAt: new Date().toISOString() }, ...withoutThisPath];
  await store.set(NAMESPACE, KEY, { version: current.version + 1, entries }, { durability: "sync" });
}

/** Called once a REAL build/publish of `path` succeeds
 * (`routes/pages-build.ts`'s `publishOne`) - the flag's only intended way to
 * clear. No-op (and no version bump) if `path` wasn't flagged, so a build
 * that was never AI-touched doesn't spuriously wake up every poller. */
export async function clearAiPageSourceWrite(path: string, env: Record<string, unknown> = {}): Promise<void> {
  const store = getAuthSecurityStore(env);
  const current = await readLog(env);
  const entries = current.entries.filter((entry) => entry.path !== path);
  if (entries.length === current.entries.length) return;
  await store.set(NAMESPACE, KEY, { version: current.version + 1, entries }, { durability: "sync" });
}

export async function listAiPageSourceFlags(env: Record<string, unknown> = {}): Promise<AiPageSourceFlag[]> {
  return (await readLog(env)).entries;
}

/** `routes/ai-page-source-flags.ts`'s GET reads only this (never the full
 * entry list) to answer a conditional poll. */
export async function getAiPageSourceFlagsVersion(env: Record<string, unknown> = {}): Promise<number> {
  return (await readLog(env)).version;
}
