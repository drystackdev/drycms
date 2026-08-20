import * as github from "./github-source-sync.js";
import * as gitlab from "./gitlab-source-sync.js";
import * as custom from "./custom-git-source-sync.js";
import type { GitRepoConfig } from "./git-config.js";

export { PAGE_SOURCE_FILE_PATTERN } from "./github-source-sync.js";
export type { GithubSyncConfig, GithubSyncResult } from "./github-source-sync.js";

/** `custom` (a self-hosted host with no vendor API) declines every call here
 * rather than falling through to GitHub's - see `custom-git-source-sync.ts`. */
const adapter = (config: Pick<GitRepoConfig, "provider">) =>
  config.provider === "gitlab" ? gitlab : config.provider === "custom" ? custom : github;

export const pushPagesSourceSnapshot = (source: Record<string, string>, config: GitRepoConfig, message: string) => adapter(config).pushPagesSourceSnapshot(source, config, message);
export const ensureBranchExists = (config: GitRepoConfig, source: () => Promise<Record<string, string>>) => adapter(config).ensureBranchExists(config, source);
export const commitPagesSourceChanges = (config: GitRepoConfig, files: Record<string, string | null>, message: string, author: { name: string; email: string }) => adapter(config).commitPagesSourceChanges(config, files, message, author);
/** Mirrors D1 content (entries/singletons/content-type schema) as JSON under
 * the `content/` root of the same configured repo (`plans/history-content.md`)
 * - same commit machinery as `commitPagesSourceChanges`, different root. */
export const commitContentChanges = (config: GitRepoConfig, files: Record<string, string | null>, message: string, author: { name: string; email: string }) => adapter(config).commitContentChanges(config, files, message, author);
export const listSnapshotCommits = (config: GitRepoConfig, limit: number, options: { path?: string; page?: number } = {}) => adapter(config).listSnapshotCommits(config, limit, options);
export const getCommitDetail = (config: GitRepoConfig, sha: string) => adapter(config).getCommitDetail(config, sha);
export const getContentCommitDetail = (config: GitRepoConfig, sha: string) => adapter(config).getContentCommitDetail(config, sha);
export const readFileAtCommit = (config: GitRepoConfig, sha: string, path: string) => adapter(config).readFileAtCommit(config, sha, path);
export const readContentFileAtCommit = (config: GitRepoConfig, sha: string, path: string) => adapter(config).readContentFileAtCommit(config, sha, path);
export const pullPagesSourceSnapshot = (config: GitRepoConfig, sha?: string) => adapter(config).pullPagesSourceSnapshot(config, sha);
export const resetBranchToSnapshot = (config: GitRepoConfig, source: Record<string, string>, messages: { clear: string; restore: string }) => adapter(config).resetBranchToSnapshot(config, source, messages);
/** The four operations the Versions page needs, each spanning BOTH roots
 * drycms owns (page source + the `content/` mirror) rather than one of them
 * - see `status/git-versions-page.md`. */
export const pullRepositorySnapshot = (config: GitRepoConfig, sha?: string) => adapter(config).pullRepositorySnapshot(config, sha);
export const getRepositoryCommitDetail = (config: GitRepoConfig, sha: string) => adapter(config).getRepositoryCommitDetail(config, sha);
export const readRepositoryFileAtCommit = (config: GitRepoConfig, sha: string, path: string) => adapter(config).readRepositoryFileAtCommit(config, sha, path);
export const commitRepositoryChanges = (config: GitRepoConfig, files: Record<string, string | null>, message: string, author: { name: string; email: string }) => adapter(config).commitRepositoryChanges(config, files, message, author);
