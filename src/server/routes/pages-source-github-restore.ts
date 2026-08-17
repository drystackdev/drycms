import type { DryRouteHandler } from "../context.js";
import { pagesSourceStorage } from "../config.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { jsonResponse, errorResponse } from "../route-helpers.js";
import { ensureBranchExists, listSnapshotCommits, PAGE_SOURCE_FILE_PATTERN, pullPagesSourceSnapshot } from "../github-source-sync.js";
import { loadGithubSyncConfig, readPagesSourceTree } from "./pages-source-github-sync.js";
import type { StorageAdapter, StorageStatEntry } from "../../storage/types.js";

/** `pagesSourceStorage.listAll` fallback for a backend that doesn't
 * implement it (R2/S3) - same recursive walk `pages-source-github-sync.ts`'s
 * own `listAllSourcePaths` does, kept as a small page-route-local copy
 * rather than a shared export (both call sites are a few lines each). */
async function listAllSourcePaths(adapter: StorageAdapter, folder = ""): Promise<string[]> {
  const entries = await adapter.list(folder);
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "folder") {
      paths.push(...(await listAllSourcePaths(adapter, entry.path)));
    } else if (PAGE_SOURCE_FILE_PATTERN.test(entry.name)) {
      paths.push(entry.path);
    }
  }
  return paths;
}

async function listCurrentSourcePaths(adapter: StorageAdapter): Promise<string[]> {
  return adapter.listAll
    ? (await adapter.listAll()).filter((entry: StorageStatEntry) => entry.kind === "file" && PAGE_SOURCE_FILE_PATTERN.test(entry.name)).map((entry: StorageStatEntry) => entry.path)
    : listAllSourcePaths(adapter);
}

/**
 * `GET {path}/api/github-restore` - lists `githubSync`'s recent commits
 * (the deleted Page Editor's History dialog), each one a full pages-source
 * snapshot (`github-source-sync.ts`'s `listSnapshotCommits` doc comment).
 * `?limit=` caps the page size, default 30. Gated on `PAGE_BUILDER_RESOURCE_ID`
 * (`"system-build"`) in `handler.ts` - the same merged resource `github-sync`'s
 * push route and `pages-source`'s write methods use (see that constant's own
 * doc comment in `content-types/permissions.ts` for why editing code and
 * publishing it are one grant, not two).
 *
 * If `branch` doesn't exist on GitHub yet (first time Sync is turned on
 * against a fresh repo), self-heals via `ensureBranchExists` - creates it
 * with an initial snapshot commit of the current pages-source tree - instead
 * of surfacing GitHub's 404 as a dead-end "Not Found" status.
 */
export const GET: DryRouteHandler = async (context) => {
  try {
    const loaded = await loadGithubSyncConfig(context);
    if ("error" in loaded) return jsonResponse({ configured: false, reason: loaded.error, commits: [] });

    const limitParam = context.url.searchParams.get("limit");
    const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam) || 30)) : 30;
    let result = await listSnapshotCommits(loaded.config, limit);
    if (!result.ok) {
      const ensured = await ensureBranchExists(loaded.config, () => readPagesSourceTree(context));
      if (!ensured.ok) return jsonResponse({ configured: true, repo: loaded.config.repo, branch: loaded.config.branch, reason: ensured.reason, commits: [] });
      if (ensured.created) result = await listSnapshotCommits(loaded.config, limit);
    }
    // `repo`/`branch` (never `token`) are echoed back so `PageBuilder.tsx` can
    // show what "Reset all"/"Restore" actually pulls from - e.g. the typed
    // "type the repo name to confirm" prompt on the Reset dialog.
    if (!result.ok) return jsonResponse({ configured: true, repo: loaded.config.repo, branch: loaded.config.branch, reason: result.reason, commits: [] });
    return jsonResponse({ configured: true, repo: loaded.config.repo, branch: loaded.config.branch, commits: result.commits });
  } catch (error) {
    return errorResponse(error);
  }
};

/**
 * `POST {path}/api/github-restore` - pulls a full pages-source snapshot from
 * GitHub (`{sha}` in the body, or `githubSync.branch`'s current HEAD when
 * omitted) and OVERWRITES `pagesSourceStorage` with it: every `.tsx`/`.ts`
 * file not present in the pulled snapshot is removed, every file the
 * snapshot has is written. Backs both "Reset all from GitHub" (no `sha` -
 * the deleted Page Editor's Settings menu) and History's "Restore this commit" (a
 * specific `sha`) - same mechanism, different starting point. The caller
 * (`PageBuilder.tsx`) reloads its file tree and re-triggers "Build all"
 * itself once this returns `applied: true`; this route only ever touches
 * `pagesSourceStorage`, never the published `built/live/*` output.
 *
 * Same self-heal as this file's `GET` for the branch-HEAD case (no `sha` -
 * "Reset all"): a missing `branch` gets created from the current
 * pages-source tree via `ensureBranchExists` before pulling, so a direct
 * POST (or a race with `GET`) can't fail with "Not Found" either. Not
 * applied when `sha` is given (History's "Restore this commit") - a branch
 * that doesn't exist can't have a specific commit to restore.
 */
export const POST: DryRouteHandler = async (context) => {
  try {
    const loaded = await loadGithubSyncConfig(context);
    if ("error" in loaded) return jsonResponse({ applied: false, reason: loaded.error });

    const body = (await context.request.json().catch(() => ({}))) as { sha?: unknown };
    const sha = typeof body.sha === "string" && body.sha.trim() ? body.sha.trim() : undefined;

    if (!sha) {
      const ensured = await ensureBranchExists(loaded.config, () => readPagesSourceTree(context));
      if (!ensured.ok) return jsonResponse({ applied: false, reason: ensured.reason });
    }

    const pulled = await pullPagesSourceSnapshot(loaded.config, sha);
    if (!pulled.ok) return jsonResponse({ applied: false, reason: pulled.reason });

    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const currentPaths = await listCurrentSourcePaths(adapter);
    const nextPaths = new Set(Object.keys(pulled.sourceByPath));

    for (const path of currentPaths) {
      if (!nextPaths.has(path)) await adapter.remove(path);
    }
    for (const [path, content] of Object.entries(pulled.sourceByPath)) {
      await adapter.write(path, new TextEncoder().encode(content));
    }

    return jsonResponse({ applied: true, sha: pulled.sha, fileCount: nextPaths.size });
  } catch (error) {
    return errorResponse(error);
  }
};
