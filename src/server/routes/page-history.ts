import type { DryRouteHandler } from "../context.js";
import { jsonResponse } from "../route-helpers.js";
import { getCommitDetail, listSnapshotCommits, pullPagesSourceSnapshot, readFileAtCommit } from "../git-source-sync.js";
import { loadGithubSyncConfig } from "./pages-source-github-sync.js";

export const GET: DryRouteHandler = async (context) => {
  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ configured: false, reason: loaded.error });
  const slug = context.params.slug ?? "";
  const sha = context.url.searchParams.get("sha")?.trim() ?? "";
  if (slug === "") {
    const limit = Math.min(100, Math.max(1, Number(context.url.searchParams.get("limit")) || 30));
    const page = Math.max(1, Number(context.url.searchParams.get("page")) || 1);
    const result = await listSnapshotCommits(loaded.config, limit, { path: context.url.searchParams.get("path") || undefined, page });
    return result.ok ? jsonResponse({ configured: true, commits: result.commits }) : jsonResponse({ configured: true, commits: [], reason: result.reason });
  }
  if (!sha) return jsonResponse({ error: "invalid_request", message: "A commit sha is required." }, 400);
  if (slug === "commit") {
    const result = await getCommitDetail(loaded.config, sha);
    return result.ok ? jsonResponse(result) : jsonResponse({ error: "github_error", message: result.reason }, 502);
  }
  if (slug === "file") {
    const path = context.url.searchParams.get("path") ?? "";
    const result = await readFileAtCommit(loaded.config, sha, path);
    return result.ok ? jsonResponse(result) : jsonResponse({ error: "github_error", message: result.reason }, 502);
  }
  if (slug === "tree") {
    const result = await pullPagesSourceSnapshot(loaded.config, sha);
    return result.ok ? jsonResponse({ sourceByPath: result.sourceByPath }) : jsonResponse({ error: "github_error", message: result.reason }, 502);
  }
  return jsonResponse({ error: "not_found", message: "Unknown history operation." }, 404);
};
