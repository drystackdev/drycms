import type { FileEntry } from "./entry-types.js";
import { storagePathParent } from "./path.js";
import type { StorageStatEntry } from "./types.js";

/** Maps a server-side stat result to the client's existing `FileEntry` shape
 * - `id`/`parentId` are real relative paths, not synthetic mock ids. */
export function toFileEntry(stat: StorageStatEntry): FileEntry {
  const parentPath = stat.path === "" ? "" : storagePathParent(stat.path);
  const entry: FileEntry = {
    id: stat.path,
    name: stat.name,
    parentId: parentPath || null,
    kind: stat.kind,
    size: stat.size,
    modifiedAt: stat.modifiedAt,
  };

  if (stat.kind === "file") {
    const dotIndex = stat.name.lastIndexOf(".");
    if (dotIndex > 0) entry.ext = stat.name.slice(dotIndex + 1).toLowerCase();
    if (stat.contentHash !== undefined) entry.contentHash = stat.contentHash;
  } else if (stat.fileCount !== undefined) {
    entry.fileCount = stat.fileCount;
  }

  return entry;
}
