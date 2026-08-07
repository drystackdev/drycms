import type { StorageAdapter } from "../storage/types.js";
import { entryMediaFolderPath, tempEntryMediaFolderPath } from "./entry-media-paths.js";

/**
 * Keeps a slugged entry's dedicated media folder (`entry/<slug>/`) in sync
 * with its slug, mirroring `redirects.ts`'s `recordSlugRedirect` - fetch the
 * old value before the save, call this after, no-op if nothing changed.
 *
 * - `fromSlug` unset (first save of a brand-new entry): moves that user's
 *   temp upload folder (`tempEntryMediaFolderPath`) to `entry/<toSlug>`, if
 *   it exists - it won't if nothing was ever uploaded pre-save.
 * - `fromSlug` set and different from `toSlug` (a rename): moves
 *   `entry/<fromSlug>` to `entry/<toSlug>`, if the old folder exists - it
 *   won't if the entry never had any media.
 * - `fromSlug === toSlug`, or `toSlug` missing: no-op.
 *
 * Deliberately non-transactional, same as `recordSlugRedirect`: this runs
 * after the entry's DB write has already committed.
 */
export async function syncEntryMediaFolder(
  adapter: StorageAdapter,
  params: { collectionName: string; userEmail: string; fromSlug?: string | null; toSlug?: string | null },
): Promise<void> {
  const { collectionName, userEmail, fromSlug, toSlug } = params;
  if (!toSlug || fromSlug === toSlug) return;
  const targetPath = entryMediaFolderPath(toSlug);

  if (fromSlug) {
    const sourcePath = entryMediaFolderPath(fromSlug);
    if (await adapter.stat(sourcePath)) await adapter.move(sourcePath, targetPath);
    return;
  }

  const tempPath = tempEntryMediaFolderPath(collectionName, userEmail);
  if (await adapter.stat(tempPath)) await adapter.move(tempPath, targetPath);
}

/** Removes a deleted entry's media folder, if it has one. */
export async function removeEntryMediaFolder(adapter: StorageAdapter, slug: string): Promise<void> {
  const path = entryMediaFolderPath(slug);
  if (await adapter.stat(path)) await adapter.remove(path);
}
