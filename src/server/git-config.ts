import type { DryRouteContext } from "./context.js";
import { getContentAdapters } from "./content-adapters.js";
import { decryptSecret } from "../lib/secret-crypto.js";
import { GITHUB_SYNC_TYPE_ID } from "../content-types/system-fields.js";
import { parseGitRepositorySetting, type GitProvider } from "../lib/git-provider.js";

export interface GitRepoConfig {
  /** `"owner/name"`, or a nested `"group/sub/name"` outside GitHub. */
  repo: string;
  provider: GitProvider;
  /** The host's origin (`https://gitlab.com`) - `""` only for a legacy
   * GitHub-only value that predates the URL-based setting. */
  url: string;
  /** Basic-auth username the admin put in the repository URL's userinfo, for
   * a self-hosted host that wants a real user name next to the token. `""`
   * means the provider's token-only convention applies (`lib/git-provider.ts`). */
  user: string;
  branch: string;
  /** `""` when no token is stored. The git proxy then talks to GitHub
   * anonymously, which only ever works for a PUBLIC repo - deliberately not
   * an error at this layer: Settings is where a missing/invalid PAT is
   * rejected (with a real `GET /user` + `permissions.push` check), and the
   * anonymous path is what makes a read-only spike against a public repo
   * possible without handing this server any credential at all. */
  token: string;
}

/**
 * The one place the `githubSync` singleton (repo/branch/encrypted PAT) is
 * read and decrypted - shared by the git smart-HTTP proxy (`routes/git.ts`)
 * and the older snapshot push/restore routes (`github-source-sync.ts`'s
 * callers), so the repo+branch validation only lives once.
 *
 * Never throws: every failure comes back as `{ error }` with a message the
 * caller can show verbatim, since "GitHub isn't configured yet" is an
 * ordinary state for a fresh tenant, not an exception.
 */
export async function loadGitConfig(context: DryRouteContext): Promise<{ config: GitRepoConfig } | { error: string }> {
  // GitHub is product configuration owned by the `githubSync` singleton and
  // its Settings page. Environment variables must not silently bypass the
  // first-login setup gate or override what an administrator saved there.
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.id === GITHUB_SYNC_TYPE_ID);
  if (!type) return { error: "not-configured" };

  const row = await entries.getSingletonEntry(type, allTypes);
  const value = (row?.value ?? {}) as { repo?: string; branch?: string };
  if (!row || !value.repo || !value.branch) return { error: "not-configured" };

  const raw = await entries.getRawEntry(type, row.id);
  const encryptedToken = typeof raw?.token === "string" ? raw.token : "";
  const repository = parseGitRepositorySetting(value.repo);
  if (!encryptedToken) return { config: { ...repository, branch: value.branch, token: "" } };

  try {
    return { config: { ...repository, branch: value.branch, token: await decryptSecret(encryptedToken) } };
  } catch {
    return { error: "The stored Git token cannot be decrypted with the current DRYCMS_SECRET_KEY." };
  }
}

/** `"owner/name"` - anything else is rejected before it can reach a URL.
 * The repo comes from this server's own config (never the request), so this
 * is defence in depth against a bad value being saved, not the primary
 * guard. GitHub is the only platform with a fixed two-segment path; GitLab
 * has nested groups, and a self-hosted host may have either. */
export function isValidRepoSlug(repo: string, provider: GitProvider = "github"): boolean {
  const segment = "[A-Za-z0-9._-]+";
  const pattern = provider === "github" ? new RegExp(`^${segment}/${segment}$`) : new RegExp(`^${segment}(?:/${segment})+$`);
  return pattern.test(repo) && !repo.includes("..");
}
