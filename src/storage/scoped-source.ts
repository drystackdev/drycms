import type { FileEntry, FileManagerSource } from "./entry-types.js";

function toAbsoluteId(prefix: string, id: string | null): string {
  return id ? `${prefix}/${id}` : prefix;
}

function toScopedId(prefix: string, absoluteId: string): string {
  if (absoluteId === prefix) return "";
  return absoluteId.startsWith(`${prefix}/`) ? absoluteId.slice(prefix.length + 1) : absoluteId;
}

function toScopedParentId(prefix: string, absoluteParentId: string | null): string | null {
  if (absoluteParentId === null || absoluteParentId === prefix) return null;
  return toScopedId(prefix, absoluteParentId);
}

function remapEntry(prefix: string, entry: FileEntry): FileEntry {
  return { ...entry, id: toScopedId(prefix, entry.id), parentId: toScopedParentId(prefix, entry.parentId) };
}

/**
 * Sandboxes a `FileManagerSource` to one subfolder (`folderPath`, relative
 * to the delegate's own root) - `folderId: null` becomes that subfolder
 * instead of the delegate's real root, and every id in/out is prefixed/
 * stripped so nothing outside the subtree is ever reachable. `FileManager`
 * itself needs no changes for this: it only ever navigates entries this
 * source hands back (see `entry-media-paths.ts`'s doc comment on the entry-
 * media folder convention this backs).
 *
 * The scoped folder may not exist yet (e.g. a brand-new entry's temp folder
 * before its first upload) - a `list()`/`listAll()` failure at the scoped
 * root is treated as "nothing here yet" rather than propagated, since the
 * delegate has no dedicated "doesn't exist" signal a client-side caller can
 * reliably distinguish from other errors (see `http-source.ts`'s `parseJson`,
 * which only ever surfaces a plain `Error` with a message). A failure below
 * the root still throws - that's a real error worth surfacing.
 */
export function scopeFileSource(delegate: FileManagerSource, folderPath: string): FileManagerSource {
  async function list(folderId: string | null): Promise<FileEntry[]> {
    try {
      const entries = await delegate.list(toAbsoluteId(folderPath, folderId));
      return entries.map((entry) => remapEntry(folderPath, entry));
    } catch (error) {
      if (folderId === null) return [];
      throw error;
    }
  }

  async function listAll(): Promise<FileEntry[] | null> {
    if (!delegate.listAll) return null;
    let all: FileEntry[] | null;
    try {
      all = await delegate.listAll();
    } catch {
      return [];
    }
    if (all === null) return null;
    return all
      .filter((entry) => entry.id === folderPath || entry.id.startsWith(`${folderPath}/`))
      .filter((entry) => entry.id !== folderPath)
      .map((entry) => remapEntry(folderPath, entry));
  }

  const source: FileManagerSource = { list };
  if (delegate.listAll) source.listAll = listAll;

  if (delegate.upload) {
    const upload = delegate.upload;
    source.upload = async (folderId, files) => {
      const entries = await upload(toAbsoluteId(folderPath, folderId), files);
      return entries.map((entry) => remapEntry(folderPath, entry));
    };
  }
  if (delegate.createFolder) {
    const createFolder = delegate.createFolder;
    source.createFolder = async (folderId, name) => remapEntry(folderPath, await createFolder(toAbsoluteId(folderPath, folderId), name));
  }
  if (delegate.move) {
    const move = delegate.move;
    source.move = async (ids, targetFolderId) => {
      const entries = await move(ids.map((id) => toAbsoluteId(folderPath, id)), toAbsoluteId(folderPath, targetFolderId));
      return entries.map((entry) => remapEntry(folderPath, entry));
    };
  }
  if (delegate.copy) {
    const copy = delegate.copy;
    source.copy = async (ids, targetFolderId) => {
      const entries = await copy(ids.map((id) => toAbsoluteId(folderPath, id)), toAbsoluteId(folderPath, targetFolderId));
      return entries.map((entry) => remapEntry(folderPath, entry));
    };
  }
  if (delegate.remove) {
    const remove = delegate.remove;
    source.remove = async (ids) => remove(ids.map((id) => toAbsoluteId(folderPath, id)));
  }
  if (delegate.rename) {
    const rename = delegate.rename;
    source.rename = async (id, name) => remapEntry(folderPath, await rename(toAbsoluteId(folderPath, id), name));
  }
  if (delegate.replace) {
    const replace = delegate.replace;
    source.replace = async (id, file) => remapEntry(folderPath, await replace(toAbsoluteId(folderPath, id), file));
  }

  return source;
}
