export type GitProvider = "github" | "gitlab";

export const DEFAULT_GITLAB_URL = "https://gitlab.com";
const GITLAB_PREFIX = "gitlab|";

export interface GitRepositorySetting {
  provider: GitProvider;
  url: string;
  repo: string;
}

export function normalizeGitLabUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function parseGitRepositorySetting(value: string): GitRepositorySetting {
  if (!value.startsWith(GITLAB_PREFIX)) return { provider: "github", url: "", repo: value };
  const separator = value.indexOf("|", GITLAB_PREFIX.length);
  if (separator < 0) return { provider: "gitlab", url: DEFAULT_GITLAB_URL, repo: value.slice(GITLAB_PREFIX.length) };
  const encodedUrl = value.slice(GITLAB_PREFIX.length, separator);
  let url = DEFAULT_GITLAB_URL;
  try {
    url = normalizeGitLabUrl(decodeURIComponent(encodedUrl)) || DEFAULT_GITLAB_URL;
  } catch {
    // A malformed stored URL falls back to gitlab.com; repo parsing remains usable.
  }
  return { provider: "gitlab", url, repo: value.slice(separator + 1) };
}

export function serializeGitRepositorySetting(setting: GitRepositorySetting): string {
  if (setting.provider === "github") return setting.repo.trim();
  const url = normalizeGitLabUrl(setting.url) || DEFAULT_GITLAB_URL;
  return `${GITLAB_PREFIX}${encodeURIComponent(url)}|${setting.repo.trim()}`;
}
