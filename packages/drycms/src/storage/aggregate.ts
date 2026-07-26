import { storagePathParent } from "./path.js";
import type { StorageStatEntry } from "./types.js";

/** Rewrites every folder entry's `size`/`fileCount` from "immediate children
 * only" (what `list()`/`stat()` report) to a true recursive aggregate - every
 * descendant file at any depth, `fileCount` counting files only (not nested
 * folders themselves, to match the "N files" label the UI shows next to a
 * folder's size).
 *
 * Only ever called from `listAll()` implementations: recursing here is free
 * because `listAll` already has the *entire* tree in memory in one shot. The
 * same recursion from `list()`/`stat()` alone would mean walking every
 * subfolder just to stat one - exactly the per-navigation cost
 * `StorageAdapter.listAll` exists to avoid, which is why those two stay
 * immediate-children-only. Mutates `entries` in place and returns it. */
export function applyRecursiveFolderTotals(entries: StorageStatEntry[]): StorageStatEntry[] {
  const totals = new Map<string, { size: number; fileCount: number }>();
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    let parent: string | undefined = storagePathParent(entry.path);
    while (parent !== undefined) {
      const running = totals.get(parent) ?? { size: 0, fileCount: 0 };
      running.size += entry.size;
      running.fileCount += 1;
      totals.set(parent, running);
      parent = parent === "" ? undefined : storagePathParent(parent);
    }
  }
  for (const entry of entries) {
    if (entry.kind !== "folder") continue;
    const running = totals.get(entry.path) ?? { size: 0, fileCount: 0 };
    entry.size = running.size;
    entry.fileCount = running.fileCount;
  }
  return entries;
}
