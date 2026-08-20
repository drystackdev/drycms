import type { HistoryCommit, HistoryCommitFile } from "./history-http-api.js";

/**
 * Browser half of `server/routes/versions.ts` - the repository-wide history
 * behind `pages/settings/Versions.tsx` (`status/git-versions-page.md`).
 *
 * Deliberately separate from `history-http-api.ts` even though the commit
 * shapes match: that one talks to `/api/page-history` (page source only,
 * Page Builder's dock), this one to `/api/versions` (code + content in one
 * list, plus restore). Sharing the row types is the whole overlap.
 */
export type { HistoryCommit, HistoryCommitFile };

export interface VersionsList {
  configured: boolean;
  repo?: string;
  branch?: string;
  provider?: string;
  commits: HistoryCommit[];
  /** Set when the repository IS configured but the list couldn't be read
   * (bad token, host down, self-hosted git with no REST API). */
  reason?: string;
}

export interface DestructiveChange {
  contentTypeName?: string;
  tableName?: string;
  kind?: string;
  columnName?: string;
  [key: string]: unknown;
}

export interface RestorePlan {
  mode: "plan" | "apply";
  sha: string;
  source: { write: string[]; remove: string[] };
  schema: { apply: string[]; remove: string[]; destructive: DestructiveChange[] };
  entries: { restore: number; remove: number };
  warnings: string[];
  applied: boolean;
  commitSha?: string;
  commitReason?: string;
  errors: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; reason?: string };
  if (!response.ok) throw new Error(body.message ?? body.reason ?? `Request failed (${response.status}).`);
  return body;
}

export function listVersions(adminPath: string, options: { limit?: number; page?: number } = {}): Promise<VersionsList> {
  const query = new URLSearchParams();
  if (options.limit) query.set("limit", String(options.limit));
  if (options.page) query.set("page", String(options.page));
  return request<VersionsList>(`${adminPath}/api/versions?${query}`);
}

export function getVersionCommit(adminPath: string, sha: string): Promise<HistoryCommit & { files: HistoryCommitFile[] }> {
  return request(`${adminPath}/api/versions/commit?sha=${encodeURIComponent(sha)}`);
}

export function getVersionFile(adminPath: string, sha: string, path: string): Promise<{ content?: string; missing?: true }> {
  return request(`${adminPath}/api/versions/file?sha=${encodeURIComponent(sha)}&path=${encodeURIComponent(path)}`);
}

/** `mode: "plan"` writes nothing and reports what a restore would change -
 * always run first, since its `schema.destructive` is what the confirm
 * dialog warns about. */
export function restoreVersion(adminPath: string, sha: string, mode: "plan" | "apply"): Promise<RestorePlan> {
  return request(`${adminPath}/api/versions/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha, mode }),
  });
}
