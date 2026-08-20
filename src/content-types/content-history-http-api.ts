/**
 * Thin client for `routes/content-history.ts` - mirrors
 * `page-components/git/history-http-api.ts`'s shape (same `?sha=`/`?path=`
 * idiom, same `{ok/reason}`-free "throw on non-2xx" read side), scoped to
 * git-mirrored D1 content instead of page source (`plans/history-content.md`).
 */
export interface ContentHistoryCommit { sha: string; message: string; authorName: string; date: string }
export interface ContentHistoryCommitFile { path: string; status: string; additions: number; deletions: number; patch?: string }

/** Identifies the ONE entry/singleton/schema a read is scoped to - matches
 * `routes/content-history.ts`'s `resolveTarget`. */
export type ContentHistoryTarget = { type: string; entryId?: string } | { schema: string };

function targetParams(target: ContentHistoryTarget): Record<string, string | undefined> {
  return "schema" in target ? { schema: target.schema } : { type: target.type, entryId: target.entryId };
}

async function get<T>(adminPath: string, operation: string, params: Record<string, string | number | undefined>): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  const response = await fetch(`${adminPath}/api/content-history${operation ? `/${operation}` : ""}?${query}`, { credentials: "same-origin" });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; reason?: string };
  if (!response.ok) throw new Error(body.message ?? body.reason ?? `Content history request failed (${response.status}).`);
  return body;
}

export function listContentHistory(adminPath: string, target: ContentHistoryTarget, options: { limit?: number; page?: number } = {}) {
  return get<{ configured: boolean; commits: ContentHistoryCommit[]; reason?: string }>(adminPath, "", { ...targetParams(target), ...options });
}
export function getContentHistoryCommit(adminPath: string, target: ContentHistoryTarget, sha: string) {
  return get<ContentHistoryCommit & { files: ContentHistoryCommitFile[] }>(adminPath, "commit", { ...targetParams(target), sha });
}
export function getContentHistoryFile(adminPath: string, target: ContentHistoryTarget, sha: string) {
  return get<{ content?: string; missing?: true }>(adminPath, "file", { ...targetParams(target), sha });
}

export type ContentChangeOp = "create" | "update" | "delete";
/** Entries only. A content-TYPE change is committed by the server itself as
 * part of "Apply and build" (`server/content-types-git-commit.ts`) - the
 * whole schema is one file (`content/types.json`), so there is nothing for a
 * client to assemble here. */
export type ContentChangeItem = { kind: "entry"; typeName: string; entryId?: string | null; op: ContentChangeOp };

export interface ContentCommitResult {
  committed: boolean;
  commitSha?: string;
  reason?: string;
  /** `true` for the 412 `content-history.ts` returns when no `githubSync`
   * repo/token is saved at all - the common, unremarkable case for a tenant
   * that's never turned git on. `entry-git-sync.ts` treats this as "nothing
   * to do" (discard the draft immediately), never as a failure worth
   * retrying or offering a reset over. */
  notConfigured?: boolean;
}

/** POSTs one atomic commit for `items` - never throws, a network/git failure
 * comes back as `{committed:false, reason}` the same way the server's own
 * `{ok:false,reason}` results do, so `entry-git-sync.ts`'s retry loop can
 * treat every failure mode identically. */
export async function commitContentChanges(adminPath: string, items: ContentChangeItem[]): Promise<ContentCommitResult> {
  try {
    const response = await fetch(`${adminPath}/api/content-history`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const body = (await response.json().catch(() => ({}))) as { committed?: boolean; commitSha?: string; reason?: string; message?: string };
    if (response.status === 412) return { committed: false, reason: body.reason, notConfigured: true };
    if (!response.ok) return { committed: false, reason: body.message ?? body.reason ?? `Request failed (${response.status}).` };
    return { committed: body.committed === true, commitSha: body.commitSha, reason: body.reason };
  } catch (error) {
    return { committed: false, reason: error instanceof Error ? error.message : "Network error." };
  }
}
