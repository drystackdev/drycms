import type { DryRouteHandler } from "../context.js";
import { pagesSourceStorage } from "../config.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { jsonResponse, errorResponse } from "../route-helpers.js";
import { listSnapshotCommits, pullPagesSourceSnapshot } from "../github-source-sync.js";
import { loadGithubSyncConfig } from "./pages-source-github-sync.js";
import type { StorageAdapter, StorageStatEntry } from "../../storage/types.js";

/** Same `.tsx`/`.ts`-only rule `pages-source-github-sync.ts`'s own push side
 * uses - a reset must touch exactly the files a push would have committed,
 * nothing else. */
const SOURCE_FILE_PATTERN = /\.tsx?$/i;

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
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      paths.push(entry.path);
    }
  }
  return paths;
}

async function listCurrentSourcePaths(adapter: StorageAdapter): Promise<string[]> {
  return adapter.listAll
    ? (await adapter.listAll()).filter((entry: StorageStatEntry) => entry.kind === "file" && SOURCE_FILE_PATTERN.test(entry.name)).map((entry: StorageStatEntry) => entry.path)
    : listAllSourcePaths(adapter);
}

/**
 * `GET {path}/api/github-restore` - lists `githubSync`'s recent commits
 * (`PageEditor.tsx`'s History dialog), each one a full pages-source
 * snapshot (`github-source-sync.ts`'s `listSnapshotCommits` doc comment).
 * `?limit=` caps the page size, default 30. Gated on `system-code` in
 * `handler.ts` (same as `pages-source`'s own write methods) - this is part
 * of the Code Editor's Settings surface, not the build orchestrator's
 * `system-build` (unlike `github-sync`'s push route).
 */
export const GET: DryRouteHandler = async (context) => {
  try {
    const loaded = await loadGithubSyncConfig(context);
    if ("error" in loaded) return jsonResponse({ configured: false, reason: loaded.error, commits: [] });

    const limitParam = context.url.searchParams.get("limit");
    const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam) || 30)) : 30;
    const result = await listSnapshotCommits(loaded.config, limit);
    // `repo`/`branch` (never `token`) are echoed back so `PageEditor.tsx` can
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
 * PageEditor.tsx's Settings menu) and History's "Restore this commit" (a
 * specific `sha`) - same mechanism, different starting point. The caller
 * (`PageEditor.tsx`) reloads its file tree and re-triggers "Build all"
 * itself once this returns `applied: true`; this route only ever touches
 * `pagesSourceStorage`, never the published `built/live/*` output.
 */
export const POST: DryRouteHandler = async (context) => {
  try {
    const loaded = await loadGithubSyncConfig(context);
    if ("error" in loaded) return jsonResponse({ applied: false, reason: loaded.error });

    const body = (await context.request.json().catch(() => ({}))) as { sha?: unknown };
    const sha = typeof body.sha === "string" && body.sha.trim() ? body.sha.trim() : undefined;

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
