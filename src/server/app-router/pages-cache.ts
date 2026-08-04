import { createStorageAdapter, StorageError, type StorageAdapter } from "../../storage/index.js";
import { bufferOf } from "../../storage/util.js";
import { pagesCacheStorage } from "../config.js";
import { BUILD_ID } from "./build-id.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

interface PageCacheEnvelope {
  html: string;
  versions: Record<string, number>;
  buildId: string;
  renderedAt: string;
}

let adapter: StorageAdapter | undefined;
function storage(): StorageAdapter {
  if (!adapter) adapter = createStorageAdapter(pagesCacheStorage);
  return adapter;
}

function cacheKeyFor(pathname: string): string {
  const normalized = pathname === "/" ? "__root__" : pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${encodeURIComponent(normalized)}.json`;
}

/**
 * Cached HTML if it's still fresh - `null` on any kind of miss (no cache
 * file, a different `BUILD_ID`, or any touched content type's
 * `getResourceVersion()` has moved since it was cached). Never throws for
 * a routine miss - see `plans/app-router.md`'s "Luồng 1 request". Caller
 * (`page-handler.ts`) is responsible for gating this to production only
 * (`import.meta.env.DEV`) - this module doesn't gate itself.
 */
export async function readPageCache(
  pathname: string,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
): Promise<string | null> {
  let envelope: PageCacheEnvelope;
  try {
    const file = await storage().read(cacheKeyFor(pathname));
    envelope = JSON.parse((await bufferOf(file.stream)).toString("utf8")) as PageCacheEnvelope;
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") return null;
    throw error;
  }

  if (envelope.buildId !== BUILD_ID) return null;

  for (const [typeName, cachedVersion] of Object.entries(envelope.versions)) {
    const type = allTypes.find((t) => t.name === typeName);
    // A type that no longer exists can't be re-checked - treat the entry
    // as stale rather than trusting a cache built against a type that's
    // since been deleted.
    if (!type) return null;
    const currentVersion = await entries.getResourceVersion(type);
    if (currentVersion !== cachedVersion) return null;
  }

  return envelope.html;
}

/**
 * Snapshots every touched type's current version and overwrites whatever
 * cache entry already sat at this pathname - see "buildId - lưu như
 * metadata" in `plans/app-router.md` for why this is an overwrite-in-place
 * rather than a per-build path. Swallows its own errors (logs instead) -
 * a cache-write failure must never break the response that already
 * reached the client (`render.ts` streams the body before this ever
 * runs).
 */
export async function writePageCache(
  pathname: string,
  html: string,
  touchedTypes: Set<string>,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
): Promise<void> {
  try {
    const versions: Record<string, number> = {};
    for (const typeName of touchedTypes) {
      const type = allTypes.find((t) => t.name === typeName);
      if (!type) continue;
      versions[typeName] = await entries.getResourceVersion(type);
    }
    const envelope: PageCacheEnvelope = {
      html,
      versions,
      buildId: BUILD_ID,
      renderedAt: new Date().toISOString(),
    };
    await storage().write(cacheKeyFor(pathname), Buffer.from(JSON.stringify(envelope), "utf8"));
  } catch (error) {
    console.error("[drycms] failed to write pages-cache entry:", error);
  }
}
