import { fetchNoRedirect, validateOutboundUrlForRequest } from "./outbound-url.js";
import { PAGE_SOURCE_FILE_PATTERN, type GithubCommitDetailResult, type GithubFileAtCommitResult, type GithubHistoryResult, type GithubPatchResult, type GithubPullResult, type GithubSyncResult } from "./github-source-sync.js";
import type { GitRepoConfig } from "./git-config.js";
import { PAGES_SOURCE_ROOTS } from "./app-router/source-roots.js";

type GitLabConfig = Pick<GitRepoConfig, "url" | "repo" | "branch" | "token">;
const REQUEST_TIMEOUT_MS = 15000;

class GitLabApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function gitlabRequest<T>(config: GitLabConfig, path: string, init: RequestInit = {}): Promise<T> {
  const base = await validateOutboundUrlForRequest(config.url, "GitLab URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchNoRedirect(`${base}/api/v4${path}`, {
      ...init,
      headers: { "PRIVATE-TOKEN": config.token, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string | Record<string, string[]> };
      throw new GitLabApiError(typeof body.message === "string" ? body.message : `GitLab API returned HTTP ${response.status}.`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}

async function gitlabTextRequest(config: GitLabConfig, path: string): Promise<string> {
  const base = await validateOutboundUrlForRequest(config.url, "GitLab URL");
  const response = await fetchNoRedirect(`${base}/api/v4${path}`, { headers: { "PRIVATE-TOKEN": config.token, Accept: "text/plain" } });
  if (!response.ok) throw new GitLabApiError(`GitLab API returned HTTP ${response.status}.`, response.status);
  return response.text();
}

const projectPath = (config: GitLabConfig) => `/projects/${encodeURIComponent(config.repo)}`;
const isPageSourcePath = (path: string) => PAGES_SOURCE_ROOTS.some((root) => path.startsWith(`${root.id}/`)) && PAGE_SOURCE_FILE_PATTERN.test(path);

interface GitLabTreeEntry { path: string; type: "blob" | "tree" }
interface GitLabCommit { id: string; title?: string; message: string; author_name: string; authored_date: string }
interface GitLabDiff { new_path: string; old_path: string; new_file: boolean; deleted_file: boolean; diff: string }

async function listTree(config: GitLabConfig, ref: string): Promise<GitLabTreeEntry[]> {
  const all: GitLabTreeEntry[] = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ ref, recursive: "true", per_page: "100", page: String(page) });
    const batch = await gitlabRequest<GitLabTreeEntry[]>(config, `${projectPath(config)}/repository/tree?${query}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

async function branchExists(config: GitLabConfig): Promise<boolean> {
  try {
    await gitlabRequest(config, `${projectPath(config)}/repository/branches/${encodeURIComponent(config.branch)}`);
    return true;
  } catch (error) {
    if (error instanceof GitLabApiError && error.status === 404) return false;
    throw error;
  }
}

async function createCommit(config: GitLabConfig, message: string, actions: unknown[], author?: { name: string; email: string }): Promise<string> {
  const exists = await branchExists(config);
  let startBranch: string | undefined;
  if (!exists) {
    const project = await gitlabRequest<{ default_branch?: string }>(config, projectPath(config));
    startBranch = project.default_branch;
  }
  const commit = await gitlabRequest<{ id: string }>(config, `${projectPath(config)}/repository/commits`, {
    method: "POST",
    body: JSON.stringify({ branch: config.branch, commit_message: message, actions, ...(startBranch ? { start_branch: startBranch } : {}), ...(author ? { author_name: author.name, author_email: author.email } : {}) }),
  });
  return commit.id;
}

export async function pushPagesSourceSnapshot(sourceByPath: Record<string, string>, config: GitLabConfig, message: string): Promise<GithubSyncResult> {
  if (!Object.keys(sourceByPath).length) return { pushed: false, reason: "No pages-source files to snapshot." };
  try {
    const existing = (await branchExists(config)) ? new Set((await listTree(config, config.branch)).filter((entry) => entry.type === "blob").map((entry) => entry.path)) : new Set<string>();
    const actions = Object.entries(sourceByPath).map(([file_path, content]) => ({ action: existing.has(file_path) ? "update" : "create", file_path, content, encoding: "text" }));
    return { pushed: true, commitSha: await createCommit(config, message, actions) };
  } catch (error) { return { pushed: false, reason: error instanceof Error ? error.message : "GitLab sync failed." }; }
}

export async function ensureBranchExists(config: GitLabConfig, source: () => Promise<Record<string, string>>) {
  try {
    if (await branchExists(config)) return { ok: true as const, created: false };
    const result = await pushPagesSourceSnapshot(await source(), config, "Initial commit");
    return result.pushed ? { ok: true as const, created: true } : { ok: false as const, reason: result.reason };
  } catch (error) { return { ok: false as const, reason: error instanceof Error ? error.message : "Failed to check the GitLab branch." }; }
}

export async function commitPagesSourceChanges(config: GitLabConfig, files: Record<string, string | null>, message: string, author: { name: string; email: string }): Promise<GithubPatchResult> {
  if (Object.keys(files).some((path) => !isPageSourcePath(path))) return { ok: false, reason: "A path is outside page source." };
  try {
    const existing = new Set((await listTree(config, config.branch)).filter((entry) => entry.type === "blob").map((entry) => entry.path));
    const actions = Object.entries(files).flatMap(([file_path, content]) => content === null
      ? (existing.has(file_path) ? [{ action: "delete", file_path }] : [])
      : [{ action: existing.has(file_path) ? "update" : "create", file_path, content, encoding: "text" }]);
    if (!actions.length) return { ok: false, reason: "No page-source changes to commit." };
    return { ok: true, commitSha: await createCommit(config, message, actions, author) };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "GitLab commit failed." }; }
}

export async function listSnapshotCommits(config: GitLabConfig, limit: number, options: { path?: string; page?: number } = {}): Promise<GithubHistoryResult> {
  try {
    const query = new URLSearchParams({ ref_name: config.branch, per_page: String(limit), page: String(options.page ?? 1) });
    if (options.path) query.set("path", options.path);
    const commits = await gitlabRequest<GitLabCommit[]>(config, `${projectPath(config)}/repository/commits?${query}`);
    return { ok: true, commits: commits.map((entry) => ({ sha: entry.id, message: entry.message, authorName: entry.author_name, date: entry.authored_date })) };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "Failed to list GitLab commits." }; }
}

export async function readFileAtCommit(config: GitLabConfig, sha: string, path: string): Promise<GithubFileAtCommitResult> {
  if (!isPageSourcePath(path)) return { ok: false, reason: "The path is outside page source." };
  try {
    const content = await gitlabTextRequest(config, `${projectPath(config)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(sha)}`);
    return { ok: true, content };
  } catch (error) {
    if (error instanceof GitLabApiError && error.status === 404) return { ok: true, missing: true };
    return { ok: false, reason: error instanceof Error ? error.message : "Failed to read the file from GitLab." };
  }
}

export async function pullPagesSourceSnapshot(config: GitLabConfig, sha?: string): Promise<GithubPullResult> {
  try {
    const ref = sha ?? config.branch;
    const entries = (await listTree(config, ref)).filter((entry) => entry.type === "blob" && isPageSourcePath(entry.path));
    const files = await Promise.all(entries.map(async (entry) => {
      const result = await readFileAtCommit(config, ref, entry.path);
      if (!("content" in result)) throw new Error("Failed to read a GitLab repository file.");
      return [entry.path, result.content] as const;
    }));
    const commit = await gitlabRequest<{ id: string }>(config, `${projectPath(config)}/repository/commits/${encodeURIComponent(ref)}`);
    return { ok: true, sha: commit.id, sourceByPath: Object.fromEntries(files) };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "Failed to pull from GitLab." }; }
}

export async function getCommitDetail(config: GitLabConfig, sha: string): Promise<GithubCommitDetailResult> {
  try {
    const [commit, diffs] = await Promise.all([
      gitlabRequest<GitLabCommit>(config, `${projectPath(config)}/repository/commits/${encodeURIComponent(sha)}`),
      gitlabRequest<GitLabDiff[]>(config, `${projectPath(config)}/repository/commits/${encodeURIComponent(sha)}/diff`),
    ]);
    return { ok: true, sha: commit.id, message: commit.message, authorName: commit.author_name, date: commit.authored_date, files: diffs.filter((diff) => isPageSourcePath(diff.new_path || diff.old_path)).map((diff) => ({ path: diff.deleted_file ? diff.old_path : diff.new_path, status: diff.new_file ? "added" : diff.deleted_file ? "removed" : "modified", additions: 0, deletions: 0, patch: diff.diff })) };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "Failed to read the GitLab commit." }; }
}

export async function resetBranchToSnapshot(config: GitLabConfig, sourceByPath: Record<string, string>, messages: { clear: string; restore: string }): Promise<GithubPatchResult> {
  try {
    const existing = (await listTree(config, config.branch)).filter((entry) => entry.type === "blob").map((entry) => entry.path);
    if (existing.length) await createCommit(config, messages.clear, existing.map((file_path) => ({ action: "delete", file_path })));
    const actions = Object.entries(sourceByPath).map(([file_path, content]) => ({ action: "create", file_path, content, encoding: "text" }));
    return { ok: true, commitSha: await createCommit(config, messages.restore, actions) };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "GitLab reset failed." }; }
}
