export interface GithubSnapshotCommit {
  sha: string;
  message: string;
  authorName: string;
  date: string;
}

export interface GithubRestoreStatus {
  configured: boolean;
  repo?: string;
  branch?: string;
  reason?: string;
  commits: GithubSnapshotCommit[];
}

/**
 * `GET routes/pages-source-github-restore.ts` - the current `githubSync`
 * repo/branch (never the token) plus its recent snapshot commits, for
 * `PageEditor.tsx`'s Settings menu (the "type the repo name to confirm"
 * prompt on Reset, and the History dialog's commit list). Never throws -
 * same best-effort contract `triggerGithubSync` established for the push
 * side; a network failure just reads as "not configured" here.
 */
export async function fetchGithubRestoreStatus(endpoint: string, limit = 30): Promise<GithubRestoreStatus> {
  try {
    const response = await fetch(`${endpoint}?limit=${limit}`, { credentials: "same-origin" });
    if (!response.ok) return { configured: false, reason: `HTTP ${response.status}`, commits: [] };
    return (await response.json()) as GithubRestoreStatus;
  } catch (error) {
    return { configured: false, reason: error instanceof Error ? error.message : "Failed to reach the server.", commits: [] };
  }
}

export interface GithubRestoreResult {
  applied: boolean;
  sha?: string;
  fileCount?: number;
  reason?: string;
}

/**
 * `POST routes/pages-source-github-restore.ts` - pulls a full pages-source
 * snapshot from GitHub and overwrites `pagesSourceStorage` with it. Omit
 * `sha` for "Reset all from GitHub" (branch HEAD); pass a specific commit's
 * `sha` for History's "Restore this commit". Never throws, same
 * `{applied:false,reason}` contract as `triggerGithubSync`.
 */
export async function resetPagesSourceFromGithub(endpoint: string, sha?: string): Promise<GithubRestoreResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sha ? { sha } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { applied: false, reason: typeof body.reason === "string" ? body.reason : `HTTP ${response.status}` };
    return body as GithubRestoreResult;
  } catch (error) {
    return { applied: false, reason: error instanceof Error ? error.message : "Request failed." };
  }
}
