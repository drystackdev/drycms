import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { pagesSourceStorage } from "../config.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { getContentAdapters } from "../content-adapters.js";
import { jsonResponse } from "../route-helpers.js";
import { decryptSecret } from "../../lib/secret-crypto.js";
import { PAGE_SOURCE_FILE_PATTERN, pushPagesSourceSnapshot, type GithubSyncConfig } from "../github-source-sync.js";
import { GITHUB_SYNC_TYPE_ID } from "../../content-types/system-fields.js";
import { bufferOf } from "../../storage/util.js";
import type { StorageAdapter, StorageStatEntry } from "../../storage/types.js";
import { SAMPLE_PAGES_SOURCE_FILES } from "../app-router/sample-pages-source.js";
import { clearBuiltPages } from "../app-router/built-pages-storage.js";

/** Text files owned by the four page-source roots. Binary files do not
 * belong in the GitHub snapshot or the browser editor cache. */
/** `pagesSourceStorage.listAll` only exists for the `local` backend (see
 * `pages-source.ts`'s own `handleTree`) - R2 falls back to this same
 * recursive `list()` walk `PageEditor.tsx`/`PageBuild.tsx` already do
 * client-side over HTTP, just directly against the adapter instead. */
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

export async function readPagesSourceTree(context: Pick<DryRouteContext, "env">): Promise<Record<string, string>> {
  const adapter = getStorageAdapter(pagesSourceStorage, context);
  const paths = adapter.listAll
    ? (await adapter.listAll()).filter((entry: StorageStatEntry) => entry.kind === "file" && PAGE_SOURCE_FILE_PATTERN.test(entry.name)).map((entry: StorageStatEntry) => entry.path)
    : await listAllSourcePaths(adapter);
  const entries = await Promise.all(
    paths.map(async (relPath) => {
      const file = await adapter.read(relPath);
      return [relPath, (await bufferOf(file.stream)).toString("utf-8")] as const;
    }),
  );
  return Object.fromEntries(entries);
}

interface GithubSyncSingletonValue {
  enabled?: boolean;
  repo?: string;
  branch?: string;
}

/**
 * Loads+decrypts the `githubSync` singleton into a ready-to-use
 * `GithubSyncConfig`, or an `{error}` reason when it's missing/disabled/
 * unconfigured/undecryptable - shared by this route's own `POST` (push) and
 * `pages-source-github-restore.ts`'s `GET`/`POST` (list history / pull+
 * reset), so the enabled+repo+branch+token validation only lives once.
 */
export async function loadGithubSyncConfig(context: DryRouteContext): Promise<{ config: GithubSyncConfig } | { error: string }> {
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.id === GITHUB_SYNC_TYPE_ID);
  if (!type) return { error: "not-configured" };

  const row = await entries.getSingletonEntry(type, allTypes);
  const value = (row?.value ?? {}) as GithubSyncSingletonValue;
  if (!row || !value.enabled || !value.repo || !value.branch) return { error: "not-configured" };

  const raw = await entries.getRawEntry(type, row.id);
  const encryptedToken = typeof raw?.token === "string" ? raw.token : "";
  if (!encryptedToken) return { error: "not-configured" };

  try {
    const token = await decryptSecret(encryptedToken);
    return { config: { repo: value.repo, branch: value.branch, token } };
  } catch {
    return { error: "The stored GitHub token cannot be decrypted with the current DRYCMS_SECRET_KEY." };
  }
}

/**
 * `POST {path}/api/github-sync` - pushes ONE atomic snapshot commit of the
 * current `pagesSourceStorage` tree to GitHub (`github-source-sync.ts`),
 * per `status/pages-source-github-versioning.md`. Called by
 * `PageEditor.tsx`'s Build current/Build all and `PageBuild.tsx`'s Build
 * all, always AFTER their own `publishBuiltPage(s)` has already succeeded -
 * best-effort by design: this never throws a hard failure back at the
 * caller (see `pushPagesSourceSnapshot`'s own doc comment), it only ever
 * reports whether the push happened, so a GitHub outage or a missing/wrong
 * token can never block the real publish. Gated the same as `pages-build`/
 * `dry-http` (`handler.ts`'s `PAGE_BUILDER_RESOURCE_ID` check) - this is
 * part of the build flow, not a separate permission surface.
 */
export const POST: DryRouteHandler = async (context) => {
  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ pushed: false, reason: loaded.error });

  const body = (await context.request.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : `drycms build snapshot - ${new Date().toISOString()}`;

  const sourceByPath = await readPagesSourceTree(context);
  const result = await pushPagesSourceSnapshot(sourceByPath, loaded.config, message);
  return jsonResponse(result);
};

/** Clears built storage/build-registry state, replaces the working
 * pages-source tree with the committed `mock/` tree, then best-effort pushes
 * that exact snapshot to GitHub. The browser caller mirrors the returned
 * files into IndexedDB and runs Build all. */
export const PUT: DryRouteHandler = async (context) => {
  const loaded = await loadGithubSyncConfig(context);

  const sourceByPath = Object.fromEntries(SAMPLE_PAGES_SOURCE_FILES.map((file) => [file.path, file.content]));
  if (Object.keys(sourceByPath).length === 0) return jsonResponse({ applied: false, reason: "The mock pages-source tree is empty." });

  const adapter = getStorageAdapter(pagesSourceStorage, context);
  const { pagesRegistry } = getContentAdapters(context);
  await clearBuiltPages(context);
  await pagesRegistry.clearAllPages();

  // Remove each root entry recursively instead of listing every descendant
  // and deleting them one-by-one. Besides being cheaper for R2, this avoids
  // a partial reset where a parent/child deletion race leaves the source
  // root empty before the mock writes start.
  for (const entry of await adapter.list("", true)) await adapter.remove(entry.path);
  for (const [sourcePath, content] of Object.entries(sourceByPath)) {
    await adapter.write(sourcePath, new TextEncoder().encode(content));
  }
  if (pagesSourceStorage.kind === "r2") await adapter.write(".seeded", new Uint8Array(0));

  // Never return `applied: true` based only on writes not throwing. Read the
  // authoritative store back and prove every deployed mock file arrived
  // byte-for-byte; the browser only refreshes IndexedDB/builds after this.
  const stored = await readPagesSourceTree(context);
  const expectedPaths = Object.keys(sourceByPath).sort();
  const storedPaths = Object.keys(stored).sort();
  if (
    expectedPaths.length !== storedPaths.length ||
    expectedPaths.some((sourcePath, index) => sourcePath !== storedPaths[index] || stored[sourcePath] !== sourceByPath[sourcePath])
  ) {
    return jsonResponse({ applied: false, reason: "Mock files could not be verified after writing them to page-source storage." }, 500);
  }

  let commitSha: string | undefined;
  let githubReason: string | undefined;
  if ("config" in loaded) {
    const pushed = await pushPagesSourceSnapshot(sourceByPath, loaded.config, `Reset all pages from mock - ${new Date().toISOString()}`);
    if (pushed.pushed) commitSha = pushed.commitSha;
    else githubReason = pushed.reason ?? "GitHub sync failed.";
  } else {
    githubReason = loaded.error;
  }

  return jsonResponse({ applied: true, githubPushed: commitSha !== undefined, githubReason, commitSha, sourceByPath });
};
