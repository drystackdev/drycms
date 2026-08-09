import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { pagesSourceStorage } from "../config.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { getContentAdapters } from "../content-adapters.js";
import { jsonResponse } from "../route-helpers.js";
import { decryptSecret } from "../../lib/secret-crypto.js";
import { pushPagesSourceSnapshot, type GithubSyncConfig } from "../github-source-sync.js";
import { GITHUB_SYNC_TYPE_ID } from "../../content-types/system-fields.js";
import { bufferOf } from "../../storage/util.js";
import type { StorageAdapter, StorageStatEntry } from "../../storage/types.js";

/** Only `.tsx`/`.ts` counts as "source" here, same rule
 * `pages-source.ts`'s own doc comment gives for the tree - everything the
 * build pipeline/`Editer` treats as real code, nothing else (an accidental
 * binary asset dropped under `pagesSourceStorage` wouldn't survive the
 * `utf-8` blob encoding `github-source-sync.ts` uses anyway). */
const SOURCE_FILE_PATTERN = /\.tsx?$/i;

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
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      paths.push(entry.path);
    }
  }
  return paths;
}

async function readPagesSourceTree(context: Pick<DryRouteContext, "env">): Promise<Record<string, string>> {
  const adapter = getStorageAdapter(pagesSourceStorage, context);
  const paths = adapter.listAll
    ? (await adapter.listAll()).filter((entry: StorageStatEntry) => entry.kind === "file" && SOURCE_FILE_PATTERN.test(entry.name)).map((entry: StorageStatEntry) => entry.path)
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
