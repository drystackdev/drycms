import type { StorageAdapter } from "../storage/types.js";
import { entryMediaFolderPath, tempEntryMediaFolderPath } from "./entry-media-paths.js";

export interface EntryMediaMove {
  fromPath: string;
  toPath: string;
}

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
 * after the entry's DB write has already committed. Returns the old/new
 * paths when a move actually happened (`null` on every no-op above) - the
 * entry's own field VALUES (an `image`/`file` id, or a `richtext` field's
 * embedded `<img src>`) still point at whatever path they were saved with,
 * and only the caller has that value in hand to fix up (see
 * `rewriteEntryMediaPaths`).
 */
export async function syncEntryMediaFolder(
  adapter: StorageAdapter,
  params: { collectionName: string; userEmail: string; fromSlug?: string | null; toSlug?: string | null },
): Promise<EntryMediaMove | null> {
  const { collectionName, userEmail, fromSlug, toSlug } = params;
  if (!toSlug || fromSlug === toSlug) return null;
  const targetPath = entryMediaFolderPath(toSlug);

  if (fromSlug) {
    const sourcePath = entryMediaFolderPath(fromSlug);
    if (!(await adapter.stat(sourcePath))) return null;
    await adapter.move(sourcePath, targetPath);
    return { fromPath: sourcePath, toPath: targetPath };
  }

  const tempPath = tempEntryMediaFolderPath(collectionName, userEmail);
  if (!(await adapter.stat(tempPath))) return null;
  await adapter.move(tempPath, targetPath);
  return { fromPath: tempPath, toPath: targetPath };
}

/**
 * Deep-walks `value` (through plain objects/arrays - covers `flatten` and
 * `component-repeat` nesting the same way), replacing every occurrence of
 * `fromPath` with `toPath` in any string found. Field-type-agnostic on
 * purpose: an `image`/`file` field stores a bare storage id ("<path>" or a
 * comma-joined "<path>,<path>" in multiple mode), while a `richtext` field
 * stores a full HTML string with `<path>` embedded inside an `<img src>` or
 * link `href` - both are just substring replacement once you have the
 * before/after path, so this doesn't need `EntryFieldNode`s to tell them
 * apart. Safe because `fromPath` (`.tmp.<collection>.<user>` or
 * `entry/<old-slug>`) is specific enough it won't collide with unrelated
 * text. `changed: false` (with `value` the same reference) when nothing
 * matched, so a caller can skip a needless extra write. */
export function rewriteEntryMediaPaths<T>(value: T, fromPath: string, toPath: string): { value: T; changed: boolean } {
  let changed = false;
  function walk(node: unknown): unknown {
    if (typeof node === "string") {
      if (!node.includes(fromPath)) return node;
      changed = true;
      return node.split(fromPath).join(toPath);
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) out[key] = walk(val);
      return out;
    }
    return node;
  }
  const rewritten = walk(value) as T;
  return changed ? { value: rewritten, changed: true } : { value, changed: false };
}

/** Removes a deleted entry's media folder, if it has one. */
export async function removeEntryMediaFolder(adapter: StorageAdapter, slug: string): Promise<void> {
  const path = entryMediaFolderPath(slug);
  if (await adapter.stat(path)) await adapter.remove(path);
}
