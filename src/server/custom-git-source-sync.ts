import type { GitRepoConfig } from "./git-config.js";
import type {
  GithubCommitDetailResult,
  GithubEnsureBranchResult,
  GithubFileAtCommitResult,
  GithubHistoryResult,
  GithubPatchResult,
  GithubPullResult,
  GithubSyncResult,
  RepositorySnapshotResult,
} from "./github-source-sync.js";

/**
 * The `custom` provider's half of `git-source-sync.ts`'s adapter pair: every
 * REST-only operation, declined.
 *
 * A self-hosted git server (`lib/git-provider.ts`) speaks the git wire
 * protocol and nothing else we can assume - there is no GitHub Git Data API
 * and no GitLab `/api/v4` behind it (a self-hosted GitLab is detected as
 * `gitlab`, not `custom`, precisely so it keeps those). That costs the
 * server-side snapshot push and the git-mirrored history/restore features;
 * it does NOT cost code sync, which runs entirely in the browser through
 * `routes/git.ts`'s smart-HTTP proxy and works on any host.
 *
 * Declining is the whole point of this module: without it the dispatcher
 * would fall through to the GitHub adapter and quietly aim api.github.com at
 * a repository path that only exists on the admin's own server.
 */
const REASON = "This git server has no API drycms can use for snapshots or history - page source still syncs through the browser's git client. Use GitHub or GitLab for those.";

const decline = { ok: false as const, reason: REASON };

export async function pushPagesSourceSnapshot(): Promise<GithubSyncResult> {
  return { pushed: false, reason: REASON };
}

export async function ensureBranchExists(): Promise<GithubEnsureBranchResult> {
  return decline;
}

export async function commitPagesSourceChanges(): Promise<GithubPatchResult> {
  return decline;
}

export async function commitContentChanges(): Promise<GithubPatchResult> {
  return decline;
}

export async function listSnapshotCommits(): Promise<GithubHistoryResult> {
  return decline;
}

export async function getCommitDetail(): Promise<GithubCommitDetailResult> {
  return decline;
}

export async function getContentCommitDetail(): Promise<GithubCommitDetailResult> {
  return decline;
}

export async function readFileAtCommit(): Promise<GithubFileAtCommitResult> {
  return decline;
}

export async function readContentFileAtCommit(): Promise<GithubFileAtCommitResult> {
  return decline;
}

export async function pullPagesSourceSnapshot(): Promise<GithubPullResult> {
  return decline;
}

export async function resetBranchToSnapshot(): Promise<GithubPatchResult> {
  return decline;
}

export async function pullRepositorySnapshot(): Promise<RepositorySnapshotResult> {
  return decline;
}

export async function getRepositoryCommitDetail(): Promise<GithubCommitDetailResult> {
  return decline;
}

export async function readRepositoryFileAtCommit(): Promise<GithubFileAtCommitResult> {
  return decline;
}

export async function commitRepositoryChanges(): Promise<GithubPatchResult> {
  return decline;
}

/** Exported for the one caller that needs to explain the limitation rather
 * than act on it (`routes/pages-source-github-sync.ts`'s
 * `loadGithubSyncConfig`, which turns it into a "not configured for this"
 * answer before any of the above is reached). */
export const CUSTOM_GIT_UNSUPPORTED_REASON = REASON;

/** Type-level guard: this module must keep answering for a `custom` config. */
export type CustomGitConfig = Extract<GitRepoConfig["provider"], "custom">;
