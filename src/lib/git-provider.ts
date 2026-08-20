/**
 * One repository URL is the whole Git Sync setting the admin types
 * (`pages/GithubSyncSettings.tsx`): `https://gitlab.com/group/repo`. The
 * platform is DERIVED from it - there is no "Platform" picker any more, and
 * nothing downstream should ever ask the admin which API to talk to.
 *
 * `custom` is a real, supported provider, not a fallback error state: any
 * self-hosted git host that speaks smart-HTTP can be cloned, fetched and
 * pushed through `routes/git.ts`'s proxy without a vendor REST API. What it
 * cannot do is the REST-only extras (server-side snapshot push, content
 * history), which report themselves unsupported rather than failing hard.
 * A self-hosted GitLab is detected as `gitlab` (not `custom`) by
 * `routes/git.ts`'s own live probe, so those extras keep working there.
 */
export type GitProvider = "github" | "gitlab" | "custom";

export const GITHUB_URL = "https://github.com";
export const DEFAULT_GITLAB_URL = "https://gitlab.com";
/** The example the settings field shows - a full repository URL, since that
 * is now the only thing the admin is asked for. */
export const GIT_URL_PLACEHOLDER = "https://gitlab.com/your-group/your-repo";

export interface GitRepositorySetting {
  provider: GitProvider;
  /** Origin only (`https://gitlab.com`), never a path and never userinfo -
   * this is what `outbound-url.ts` validates and what every API base is
   * built from. */
  url: string;
  /** `"owner/name"`, or a nested `"group/sub/name"` outside GitHub. */
  repo: string;
  /** Basic-auth username for HTTP git, taken from the URL's own userinfo
   * (`https://myuser@git.example.com/group/repo`). Empty for the usual case,
   * where the provider's token-only convention applies instead
   * (`x-access-token` on GitHub, `oauth2` elsewhere). */
  user: string;
}

const EMPTY: GitRepositorySetting = { provider: "github", url: "", repo: "", user: "" };
const LEGACY_GITLAB_PREFIX = "gitlab|";
const PROVIDERS: readonly GitProvider[] = ["github", "gitlab", "custom"];

export function normalizeGitLabUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Host -> platform. Only the two public hosts are decidable from a name
 * alone; every other host starts as `custom` and may be upgraded to `gitlab`
 * by `routes/git.ts`'s API probe. */
export function detectGitProvider(host: string): GitProvider {
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (name === "github.com" || name === "www.github.com") return "github";
  if (name === "gitlab.com" || name === "www.gitlab.com") return "gitlab";
  return "custom";
}

/**
 * The admin's typed repository URL -> a full setting. Accepts what people
 * actually paste: with or without `.git`, with or without a trailing slash,
 * an `http(s)://` URL, a bare `git@host:group/repo.git` (converted to its
 * https form, since the token this pairs with is an HTTP credential), or the
 * bare `owner/name` older versions of this page asked for (GitHub).
 */
export function parseGitRemoteUrl(raw: string): { ok: true; setting: GitRepositorySetting } | { ok: false; error: string } {
  const invalid = { ok: false, error: `Enter the repository URL, for example ${GIT_URL_PLACEHOLDER}.` } as const;
  let value = raw.trim().replace(/\/+$/, "");
  if (!value) return invalid;

  // `git@host:group/repo.git` - an SSH remote pasted out of a "Clone" menu.
  const ssh = /^(?:ssh:\/\/)?(?:([^@/\s]+)@)?([^/\s:]+):(?!\/)(.+)$/.exec(value);
  if (ssh && !value.includes("://")) value = `https://${ssh[2]}/${ssh[3]}`;
  // A bare `owner/name`, which is what this page used to ask for on GitHub.
  else if (!value.includes("://")) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(value)) return invalid;
    value = `${GITHUB_URL}/${value}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http(s) repository URLs are supported." };
  }

  const repo = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const segments = repo.split("/").filter(Boolean);
  if (segments.length < 2) return { ok: false, error: 'The URL must include the repository path, e.g. "/your-group/your-repo".' };
  if (segments.some((segment) => segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) return invalid;

  const provider = detectGitProvider(parsed.host);
  if (provider === "github" && segments.length !== 2) {
    return { ok: false, error: 'A GitHub URL is "https://github.com/owner/repository".' };
  }
  return {
    ok: true,
    setting: {
      provider,
      url: `${parsed.protocol}//${parsed.host}`,
      repo: segments.join("/"),
      // `parsed.password` is deliberately dropped: the access token below is
      // the only credential this app stores, and it is encrypted at rest.
      user: decodeURIComponent(parsed.username),
    },
  };
}

/** The URL to show the admin (and to re-parse) - exactly what they typed,
 * normalized. */
export function gitRemoteUrl(setting: Pick<GitRepositorySetting, "url" | "repo" | "user">): string {
  if (!setting.url || !setting.repo) return "";
  const user = setting.user ? `${encodeURIComponent(setting.user)}@` : "";
  return setting.url.replace("://", `://${user}`) + `/${setting.repo}`;
}

/**
 * The `githubSync.repo` column -> a setting. Three formats are readable, all
 * of them still in the wild:
 *
 * - `"<provider>|<remote url>"` - what `serializeGitRepositorySetting` writes
 *   now. The provider is stored explicitly because it isn't always derivable
 *   from the host: a self-hosted GitLab is only known to BE GitLab after
 *   `routes/git.ts` has probed it.
 * - `"gitlab|<encoded url>|<repo>"` - the previous format, from when the
 *   admin picked a platform and a URL separately.
 * - `"owner/name"` - the original GitHub-only format.
 */
export function parseGitRepositorySetting(value: string): GitRepositorySetting {
  const raw = value.trim();
  if (!raw) return { ...EMPTY };

  const separator = raw.indexOf("|");
  const prefix = separator > 0 ? raw.slice(0, separator) : "";
  const rest = separator > 0 ? raw.slice(separator + 1) : "";
  if ((PROVIDERS as readonly string[]).includes(prefix) && /^https?:\/\//i.test(rest)) {
    const parsed = parseGitRemoteUrl(rest);
    if (parsed.ok) return { ...parsed.setting, provider: prefix as GitProvider };
    return { ...EMPTY, provider: prefix as GitProvider };
  }

  if (raw.startsWith(LEGACY_GITLAB_PREFIX)) {
    const end = raw.indexOf("|", LEGACY_GITLAB_PREFIX.length);
    if (end < 0) return { provider: "gitlab", url: DEFAULT_GITLAB_URL, repo: raw.slice(LEGACY_GITLAB_PREFIX.length), user: "" };
    let url = DEFAULT_GITLAB_URL;
    try {
      url = normalizeGitLabUrl(decodeURIComponent(raw.slice(LEGACY_GITLAB_PREFIX.length, end))) || DEFAULT_GITLAB_URL;
    } catch {
      // A malformed stored URL falls back to gitlab.com; repo parsing remains usable.
    }
    return { provider: "gitlab", url, repo: raw.slice(end + 1), user: "" };
  }

  const parsed = parseGitRemoteUrl(raw);
  return parsed.ok ? parsed.setting : { ...EMPTY, repo: raw };
}

export function serializeGitRepositorySetting(setting: GitRepositorySetting): string {
  const url = gitRemoteUrl(setting);
  // Nothing valid to write a URL from (only possible for a legacy GitHub
  // value that was never re-saved): keep the bare slug rather than losing it.
  if (!url) return setting.repo.trim();
  return `${setting.provider}|${url}`;
}
