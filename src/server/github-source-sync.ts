import { fetchNoRedirect } from "./outbound-url.js";

const GITHUB_API_BASE = "https://api.github.com";
export const PAGE_SOURCE_FILE_PATTERN = /\.(?:tsx?|css|md)$/i;
/** GitHub's own Git Data API operations (blob/tree/commit/ref) normally
 * resolve in well under a second - generous enough that a large "Build all"
 * snapshot (many blobs) on a slow connection isn't mistaken for a hang. */
const REQUEST_TIMEOUT_MS = 15000;

export interface GithubSyncConfig {
  /** "owner/name" - validated by the caller (`pages-source-github-sync.ts`
   * route), not here. */
  repo: string;
  branch: string;
  token: string;
}

export type GithubSyncResult =
  | { pushed: true; commitSha: string }
  | { pushed: false; reason: string };

interface GithubRefResponse {
  object: { sha: string };
}
interface GithubCommitResponse {
  sha: string;
  tree: { sha: string };
}
interface GithubBlobResponse {
  sha: string;
}
interface GithubTreeResponse {
  sha: string;
}
interface GithubErrorBody {
  message?: string;
}
interface GithubCommitListEntry {
  sha: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string };
    committer?: { name?: string; date?: string };
  };
}
interface GithubTreeEntry {
  path: string;
  type: string;
  sha: string;
}
interface GithubTreeListResponse {
  tree: GithubTreeEntry[];
  truncated: boolean;
}
interface GithubBlobContentResponse {
  content: string;
  encoding: string;
}

/** Carries the HTTP status alongside the message so `resolveBaseCommit` can
 * tell "this branch's ref genuinely doesn't exist yet" (404 - fall back to
 * the default branch) apart from any OTHER failure (bad token, rate limit,
 * network blip) - a plain `Error` would make every one of those look like a
 * missing branch and silently paper over the real problem instead of
 * surfacing it as a failed sync. */
class GithubApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Thin GitHub REST wrapper - every call goes through here for the shared
 * Authorization/Accept/User-Agent headers and the same abort-on-timeout
 * behavior `routes/ai.ts`'s `requestServerAiWithCredential` already
 * established for an external-provider fetch. Throws on any non-2xx (or
 * network) failure; `pushPagesSourceSnapshot` below is the one place that
 * catches it and turns it into a `{pushed:false}` result - every other
 * function here is allowed to just propagate.
 */
async function githubRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchNoRedirect(`${GITHUB_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "drycms",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as GithubErrorBody;
      throw new GithubApiError(body.message || `GitHub API returned HTTP ${response.status} for ${path}.`, response.status);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** The commit `pushPagesSourceSnapshot` should build on top of - `null` when
 * `branch` doesn't exist yet, in which case the snapshot becomes a brand new
 * parentless, `base_tree`-less commit containing only the current
 * pages-source files, never the target repo's default branch content (a
 * newly-created branch must start clean, not silently inherit whatever else
 * lives in the repo). */
async function resolveBaseCommit(repo: string, branch: string, token: string): Promise<{ sha: string; branchExists: boolean } | { sha: null; branchExists: false }> {
  try {
    const ref = await githubRequest<GithubRefResponse>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    return { sha: ref.object.sha, branchExists: true };
  } catch (error) {
    // Only a genuine "no ref yet" 404 means "create this branch fresh" -
    // anything else (bad token, rate limit, network) is a real failure and
    // must propagate, not be mistaken for a missing branch.
    if (!(error instanceof GithubApiError) || error.status !== 404) throw error;
    return { sha: null, branchExists: false };
  }
}

/**
 * Commits `sourceByPath` to `config.repo`/`config.branch` as ONE atomic
 * snapshot, via the Git Data API (blobs -> tree -> commit -> ref) rather
 * than the Contents API's per-file PUT - a "Build all" run must never leave
 * a half-applied set of file-level commits if it fails partway, and a
 * single tree/commit pair is either fully created or not created at all.
 * Never throws: every failure (config invalid, network, GitHub 4xx/5xx)
 * comes back as `{pushed:false, reason}` so a caller on the build's hot
 * path can surface it as a non-blocking warning instead of failing the
 * publish itself (see `PageBuilder.tsx`/`PageBuild.tsx`'s own callers).
 */
export async function pushPagesSourceSnapshot(
  sourceByPath: Record<string, string>,
  config: GithubSyncConfig,
  message: string,
): Promise<GithubSyncResult> {
  const paths = Object.keys(sourceByPath);
  if (paths.length === 0) return { pushed: false, reason: "No pages-source files to snapshot." };

  try {
    const base = await resolveBaseCommit(config.repo, config.branch, config.token);
    const blobs = await Promise.all(
      paths.map(async (path) => {
        const blob = await githubRequest<GithubBlobResponse>(`/repos/${config.repo}/git/blobs`, config.token, {
          method: "POST",
          body: JSON.stringify({ content: sourceByPath[path], encoding: "utf-8" }),
        });
        return { path, sha: blob.sha };
      }),
    );

    const tree = await githubRequest<GithubTreeResponse>(`/repos/${config.repo}/git/trees`, config.token, {
      method: "POST",
      body: JSON.stringify({
        tree: blobs.map(({ path, sha }) => ({ path, mode: "100644", type: "blob", sha })),
      }),
    });

    const commit = await githubRequest<GithubCommitResponse>(`/repos/${config.repo}/git/commits`, config.token, {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: base.sha ? [base.sha] : [] }),
    });

    if (base.branchExists) {
      await githubRequest(`/repos/${config.repo}/git/refs/heads/${encodeURIComponent(config.branch)}`, config.token, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } else {
      await githubRequest(`/repos/${config.repo}/git/refs`, config.token, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${config.branch}`, sha: commit.sha }),
      });
    }

    return { pushed: true, commitSha: commit.sha };
  } catch (error) {
    return { pushed: false, reason: error instanceof Error ? error.message : "GitHub sync failed." };
  }
}

export type GithubEnsureBranchResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: string };

/**
 * Makes sure `config.branch` exists on GitHub, creating it with one initial
 * snapshot commit of `sourceByPath()` when it doesn't - the first time
 * GitHub Sync is turned on against a repo that has no matching branch yet,
 * `resolveBaseCommit`'s 404 would otherwise surface to the admin as a
 * dead-end "Not Found" instead of self-healing the same way a Build's
 * `pushPagesSourceSnapshot` already does for a missing branch.
 * `sourceByPath` is a thunk so the common case (branch already exists)
 * never pays for reading the whole pages-source tree. Never throws, same
 * `{ok,reason}` contract as this file's other exports.
 */
export async function ensureBranchExists(config: GithubSyncConfig, sourceByPath: () => Promise<Record<string, string>>): Promise<GithubEnsureBranchResult> {
  try {
    const base = await resolveBaseCommit(config.repo, config.branch, config.token);
    if (base.branchExists) return { ok: true, created: false };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Failed to check the GitHub branch." };
  }

  const pushed = await pushPagesSourceSnapshot(await sourceByPath(), config, "Initial commit");
  if (!pushed.pushed) return { ok: false, reason: pushed.reason };
  return { ok: true, created: true };
}

export interface GithubSnapshotCommit {
  sha: string;
  message: string;
  authorName: string;
  date: string;
}

export type GithubHistoryResult =
  | { ok: true; commits: GithubSnapshotCommit[] }
  | { ok: false; reason: string };

/**
 * Lists `config.branch`'s recent commits (the deleted Page Editor's History
 * dialog; no UI calls it today)
 * - every one of them IS a full pages-source snapshot, since
 * `pushPagesSourceSnapshot` always commits the whole tree atomically, never
 * a partial/per-file commit. Never throws, same `{ok:false,reason}` contract
 * as `pushPagesSourceSnapshot`/`resolveBaseCommit`'s callers rely on.
 */
export async function listSnapshotCommits(
  config: Pick<GithubSyncConfig, "repo" | "branch" | "token">,
  limit: number,
): Promise<GithubHistoryResult> {
  try {
    const commits = await githubRequest<GithubCommitListEntry[]>(
      `/repos/${config.repo}/commits?sha=${encodeURIComponent(config.branch)}&per_page=${limit}`,
      config.token,
    );
    return {
      ok: true,
      commits: commits.map((entry) => ({
        sha: entry.sha,
        message: entry.commit.message,
        authorName: entry.commit.author?.name ?? entry.commit.committer?.name ?? "unknown",
        date: entry.commit.author?.date ?? entry.commit.committer?.date ?? "",
      })),
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Failed to list GitHub commits." };
  }
}

export type GithubPullResult =
  | { ok: true; sha: string; sourceByPath: Record<string, string> }
  | { ok: false; reason: string };

/**
 * The inverse of `pushPagesSourceSnapshot` - fetches the full pages-source
 * tree as it existed at `sha` (or `config.branch`'s current HEAD when `sha`
 * is omitted), via the same Git Data API the push side uses (tree ->
 * blobs), so the result is byte-identical to what was originally pushed.
 * Backs both "Reset all from GitHub" (HEAD) and History's "Restore this
 * commit" (a specific `sha`) - `pages-source-github-restore.ts` is the only
 * caller, and does the actual local-storage overwrite. Never throws, same
 * `{ok:false,reason}` contract as `pushPagesSourceSnapshot`.
 */
export async function pullPagesSourceSnapshot(config: GithubSyncConfig, sha?: string): Promise<GithubPullResult> {
  try {
    const resolvedSha =
      sha ?? (await githubRequest<GithubRefResponse>(`/repos/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`, config.token)).object.sha;
    const commit = await githubRequest<GithubCommitResponse>(`/repos/${config.repo}/git/commits/${resolvedSha}`, config.token);
    const tree = await githubRequest<GithubTreeListResponse>(`/repos/${config.repo}/git/trees/${commit.tree.sha}?recursive=1`, config.token);
    if (tree.truncated) return { ok: false, reason: "The repository tree is too large to fetch in one request." };

    const blobEntries = tree.tree.filter((entry) => entry.type === "blob" && PAGE_SOURCE_FILE_PATTERN.test(entry.path));
    const files = await Promise.all(
      blobEntries.map(async (entry) => {
        const blob = await githubRequest<GithubBlobContentResponse>(`/repos/${config.repo}/git/blobs/${entry.sha}`, config.token);
        const content = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf-8") : blob.content;
        return [entry.path, content] as const;
      }),
    );

    return { ok: true, sha: resolvedSha, sourceByPath: Object.fromEntries(files) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Failed to pull from GitHub." };
  }
}
