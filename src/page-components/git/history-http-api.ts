export interface HistoryCommit { sha: string; message: string; authorName: string; date: string }
export interface HistoryCommitFile { path: string; status: string; additions: number; deletions: number; patch?: string }

async function get<T>(adminPath: string, operation: string, params: Record<string, string | number | undefined>): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  const response = await fetch(`${adminPath}/api/page-history${operation ? `/${operation}` : ""}?${query}`, { credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as T & { message?: string; reason?: string };
  if (!response.ok) throw new Error(body.message ?? body.reason ?? `History request failed (${response.status}).`);
  return body;
}

export function listHistory(adminPath: string, options: { path?: string; limit?: number; page?: number } = {}) {
  return get<{ configured: boolean; commits: HistoryCommit[]; reason?: string }>(adminPath, "", options);
}
export function getHistoryCommit(adminPath: string, sha: string) {
  return get<HistoryCommit & { files: HistoryCommitFile[] }>(adminPath, "commit", { sha });
}
export function getHistoryFile(adminPath: string, sha: string, path: string) {
  return get<{ content?: string; missing?: true }>(adminPath, "file", { sha, path });
}
export function getHistoryTree(adminPath: string, sha: string) {
  return get<{ sourceByPath: Record<string, string> }>(adminPath, "tree", { sha });
}
