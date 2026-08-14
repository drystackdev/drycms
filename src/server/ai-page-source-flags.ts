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
 * see the same flag. Covers every page-source path (`page.tsx`, `layout.tsx`,
 * `component/*`, `styles/*`, `md/*`), not just `page.tsx` route entries - an
 * MCP overwrite of a shared layout or component is exactly as invisible to a
 * browser session as one to a page, so it deserves the same red dot. Clears
 * two ways: a real build/publish of a `page.tsx` (`routes/pages-build.ts`'s
 * `publishOne`) - the meaningful "reached the live site" event for a route
 * entry - or, for any path, the next explicit Save of that same path
 * (`routes/pages-source.ts`'s `PUT`) - there's no "build" event for a
 * component/style/md file to hook into, but an admin reviewing and
 * re-persisting it is just as much an acknowledgment.
 */
import { getAuthSecurityStore } from "./auth-security.js";

const NAMESPACE = "ai-page-source-flags";
const KEY = "global";

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
 * `path` - any page-source path (see this module's own doc comment on
 * scope). Re-flagging an already-flagged path still bumps the version and
 * refreshes `writtenAt` (a second AI write before anyone acknowledged the
 * first is still real, newer information). */
export async function markAiPageSourceWrite(path: string, env: Record<string, unknown> = {}): Promise<void> {
  const store = getAuthSecurityStore(env);
  const current = await readLog(env);
  const withoutThisPath = current.entries.filter((entry) => entry.path !== path);
  const entries = [{ path, writtenAt: new Date().toISOString() }, ...withoutThisPath];
  await store.set(NAMESPACE, KEY, { version: current.version + 1, entries }, { durability: "sync" });
}

/** Called from the two "acknowledged" events this module's own doc comment
 * describes: a real build/publish of a `page.tsx` (`routes/pages-build.ts`'s
 * `publishOne`), or an explicit Save of `path` by any session
 * (`routes/pages-source.ts`'s `PUT`). No-op (and no version bump) if `path`
 * wasn't flagged, so an ordinary build/save that was never AI-touched
 * doesn't spuriously wake up every poller. */
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
