import type { DryRouteContext } from "./context.js";
import { getContentAdapters } from "./content-adapters.js";
import { decryptSecret } from "../lib/secret-crypto.js";
import { readEnvVar } from "./options.js";
import { GITHUB_SYNC_TYPE_ID } from "../content-types/system-fields.js";

export interface GitRepoConfig {
  /** `"owner/name"`. */
  repo: string;
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
 * callers), so the enabled+repo+branch validation only lives once.
 *
 * Never throws: every failure comes back as `{ error }` with a message the
 * caller can show verbatim, since "GitHub isn't configured yet" is an
 * ordinary state for a fresh tenant, not an exception.
 */
/** A Workers secret/var (`context.env`) first, then Node's `process.env`/
 * `.env` (`options.ts`'s own resolution order) - the same two places every
 * other deployment-level value in this server comes from. */
function envValue(context: DryRouteContext, name: string): string {
  const binding = context.env?.[name];
  if (typeof binding === "string" && binding.trim()) return binding.trim();
  return readEnvVar(name)?.trim() ?? "";
}

export async function loadGitConfig(context: DryRouteContext): Promise<{ config: GitRepoConfig } | { error: string }> {
  // Deployment config wins over the admin UI's singleton: `GITHUB_REPO` /
  // `GITHUB_BRANCH` / `GITHUB_PAT_KEY` are set by whoever owns the
  // deployment (a `.env` locally, `wrangler secret put` in production), and
  // a PAT held there never lands in the content database at all - strictly
  // better than storing it encrypted in D1, and the only shape that works
  // before any admin has been able to open Settings.
  const envRepo = envValue(context, "GITHUB_REPO");
  if (envRepo) {
    return {
      config: {
        repo: envRepo,
        branch: envValue(context, "GITHUB_BRANCH") || "main",
        token: envValue(context, "GITHUB_PAT_KEY"),
      },
    };
  }

  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.id === GITHUB_SYNC_TYPE_ID);
  if (!type) return { error: "not-configured" };

  const row = await entries.getSingletonEntry(type, allTypes);
  const value = (row?.value ?? {}) as { enabled?: boolean; repo?: string; branch?: string };
  if (!row || !value.enabled || !value.repo || !value.branch) return { error: "not-configured" };

  const raw = await entries.getRawEntry(type, row.id);
  const encryptedToken = typeof raw?.token === "string" ? raw.token : "";
  if (!encryptedToken) return { config: { repo: value.repo, branch: value.branch, token: "" } };

  try {
    return { config: { repo: value.repo, branch: value.branch, token: await decryptSecret(encryptedToken) } };
  } catch {
    return { error: "The stored GitHub token cannot be decrypted with the current DRYCMS_SECRET_KEY." };
  }
}

/** `"owner/name"` - anything else is rejected before it can reach a URL.
 * The repo comes from this server's own config (never the request), so this
 * is defence in depth against a bad value being saved, not the primary
 * guard. */
export function isValidRepoSlug(repo: string): boolean {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) && !repo.includes("..");
}
