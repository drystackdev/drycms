import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse } from "../route-helpers.js";
import { requirePermission } from "../admin-access.js";
import { CONTENT_TYPES_RESOURCE_ID, PAGE_BUILDER_RESOURCE_ID } from "../../content-types/permissions.js";
import { GITHUB_SYNC_TYPE_ID } from "../../content-types/system-fields.js";
import { getRepositoryCommitDetail, listSnapshotCommits, readRepositoryFileAtCommit } from "../git-source-sync.js";
import { loadGithubSyncConfig } from "./pages-source-github-sync.js";
import { restoreCommit } from "../git-restore.js";

/**
 * `{path}/api/versions` - the whole branch's history, and going back to any
 * commit on it (`pages/settings/Versions.tsx`, `status/git-versions-page.md`).
 *
 * Different from the two history routes that already exist, and deliberately
 * a third one rather than an option on either: `page-history.ts` is scoped to
 * page source and `content-history.ts` to ONE entry/schema path, each gated
 * on that scope's own permission. This route is the repository-wide view -
 * one list covering code and content together - so it needs its own gate,
 * and a restore here rewrites all three (page source, schema, entry rows) in
 * one go.
 *
 * Permissions, checked per branch below rather than in `handler.ts`, since
 * reading and restoring are worlds apart:
 * - reading history needs the Git Sync setting grant (the same one that puts
 *   this page in the Settings nav);
 * - restoring needs BOTH the code-edit grant (`PAGE_BUILDER_RESOURCE_ID`) and
 *   the content-type setting grant, because it writes executable page source
 *   AND runs schema migrations against real tables.
 */
async function requireReadAccess(context: DryRouteContext): Promise<Response | null> {
  return requirePermission(context, GITHUB_SYNC_TYPE_ID, "setting", "You don't have permission to view the repository history.");
}

async function requireRestoreAccess(context: DryRouteContext): Promise<Response | null> {
  const code = await requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting", "Restoring a commit needs the Page Builder permission - it rewrites page source.");
  if (code) return code;
  return requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "Restoring a commit needs the content type permission - it re-applies the whole schema.");
}

export const GET: DryRouteHandler = async (context) => {
  const denied = await requireReadAccess(context);
  if (denied) return denied;

  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ configured: false, reason: loaded.error, commits: [] });
  const { repo, branch, provider } = loaded.config;

  const slug = context.params.slug ?? "";
  const sha = context.url.searchParams.get("sha")?.trim() ?? "";

  if (slug === "") {
    const limit = Math.min(100, Math.max(1, Number(context.url.searchParams.get("limit")) || 30));
    const page = Math.max(1, Number(context.url.searchParams.get("page")) || 1);
    const result = await listSnapshotCommits(loaded.config, limit, { page });
    return result.ok
      ? jsonResponse({ configured: true, repo, branch, provider, commits: result.commits })
      : jsonResponse({ configured: true, repo, branch, provider, commits: [], reason: result.reason });
  }
  if (!sha) return jsonResponse({ error: "invalid_request", message: "A commit sha is required." }, 400);
  if (slug === "commit") {
    const result = await getRepositoryCommitDetail(loaded.config, sha);
    return result.ok ? jsonResponse(result) : jsonResponse({ error: "git_error", message: result.reason }, 502);
  }
  if (slug === "file") {
    const result = await readRepositoryFileAtCommit(loaded.config, sha, context.url.searchParams.get("path") ?? "");
    return result.ok ? jsonResponse(result) : jsonResponse({ error: "git_error", message: result.reason }, 502);
  }
  return jsonResponse({ error: "not_found", message: "Unknown history operation." }, 404);
};

/**
 * `POST {path}/api/versions/restore` - `{ sha, mode }`.
 *
 * `mode: "plan"` (the default) writes NOTHING: it reports what restoring
 * that commit would change, including the data-losing migrations it implies,
 * which is what the confirm dialog shows. `mode: "apply"` performs the
 * restore and pushes ONE new commit for it - see `git-restore.ts` for why
 * the branch is never rewound.
 *
 * The build/publish half is deliberately NOT here: compiling pages runs in
 * the browser (`page-components/initial-publish.ts`), so the client kicks
 * off "Build & publish" itself once this returns `applied: true`.
 */
export const POST: DryRouteHandler = async (context) => {
  if ((context.params.slug ?? "") !== "restore") {
    return jsonResponse({ error: "not_found", message: "Unknown history operation." }, 404);
  }
  const denied = await requireRestoreAccess(context);
  if (denied) return denied;

  // Input first, config second: a malformed sha is the caller's mistake
  // either way, and saying so costs nothing, while "no repository connected"
  // is state the caller may not control.
  const body = (await context.request.json().catch(() => ({}))) as { sha?: unknown; mode?: unknown };
  const sha = typeof body.sha === "string" ? body.sha.trim() : "";
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return jsonResponse({ error: "invalid_request", message: "A commit sha is required." }, 400);
  }
  const mode = body.mode === "apply" ? "apply" : "plan";

  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ error: "git_not_configured", message: loaded.error }, 412);

  const outcome = await restoreCommit(context, loaded.config, sha, {
    mode,
    author: {
      name: context.session?.name || "drycms",
      email: `${context.session?.id ?? "admin"}@content-history.drycms`,
    },
  });
  if (!outcome.ok) return jsonResponse({ error: "git_error", message: outcome.reason }, 502);
  return jsonResponse({ mode, ...outcome.result });
};
