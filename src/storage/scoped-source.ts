import type { FileEntry, FileManagerSource } from "./entry-types.js";

function isInScope(prefix: string, id: string): boolean {
  return id === prefix || id.startsWith(`${prefix}/`);
}

/** Whether `id` belongs to `source`'s sandbox - i.e. whether a picked value
 * is one of the current entry's own media files. `false` for any unscoped
 * source (`scopeRoot` unset), so callers can pass whatever they have. */
export function isInScopeOf(source: FileManagerSource | undefined, id: string): boolean {
  return !!source?.scopeRoot && isInScope(source.scopeRoot, id);
}

/** `null` (the scoped root) becomes `prefix`; anything else is already an
 * absolute id (that's what this source hands out - see `remapEntry`) and is
 * returned untouched. Ids that somehow arrive relative are still prefixed, so
 * a caller holding an id from before this file kept them absolute - a saved
 * field value, say - keeps resolving. */
function toAbsoluteId(prefix: string, id: string | null): string {
  if (!id) return prefix;
  return isInScope(prefix, id) ? id : `${prefix}/${id}`;
}

/**
 * Ids stay ABSOLUTE (storage-root-relative, exactly what the delegate hands
 * back) - only `parentId` is re-rooted, so the scoped folder's own children
 * read as top-level (`parentId: null`) and `FileManager` treats it as its
 * root: breadcrumbs stop there (`entry-utils.ts`'s `folderPath` walks
 * `parentId`, never the id string) and nothing above it is reachable.
 *
 * Ids used to be stripped to the prefix as well, which leaked out of the
 * picker: a scoped id ("cover.jpg") is what got STORED in the field, and a
 * stored `image`/`file` value is a full storage path everywhere else
 * (`resolveImageSrc`, `entry-media.ts`'s path rewrite, the server's
 * `storage.stat()` checks) - so the pick resolved to nothing on the field,
 * on the public site, and for Magic.
 */
function remapEntry(prefix: string, entry: FileEntry): FileEntry {
  return entry.parentId === prefix ? { ...entry, parentId: null } : entry;
}

/** Creates every missing segment of `path` (root to leaf), via repeated
 * leaf-only `createFolder` calls - `routes/storage.ts`'s `readLeafName`
 * rejects a `name` containing "/", so a nested scope (`entry/<slug>`) can't
 * be created in one call the way the delegate's own `mkdir` could. Each
 * segment's "already exists" failure is swallowed (that's the expected case
 * for every segment above the leaf, and often the leaf itself under a race)
 * - any segment that fails for a real reason just means the upload retry
 * right after this fails too, surfacing that real error instead. */
async function ensureFolderPath(delegate: FileManagerSource, path: string): Promise<void> {
  if (!delegate.createFolder) return;
  let parentId: string | null = null;
  for (const segment of path.split("/").filter(Boolean)) {
    try {
      await delegate.createFolder(parentId, segment);
    } catch {
      // Already exists - fine, keep descending.
    }
    parentId = parentId ? `${parentId}/${segment}` : segment;
  }
}

/**
 * Sandboxes a `FileManagerSource` to one subfolder (`folderPath`, relative
 * to the delegate's own root) - `folderId: null` becomes that subfolder
 * instead of the delegate's real root, and nothing outside the subtree is
 * ever listed or reachable. Ids stay absolute (see `remapEntry` above);
 * only the scoped root's own children are re-parented to `null`.
 * `FileManager` itself needs no changes for this: it only ever navigates
 * entries this source hands back (see `entry-media-paths.ts`'s doc comment
 * on the entry-media folder convention this backs).
 *
 * The scoped folder may not exist yet (e.g. a brand-new entry's temp folder,
 * or an existing entry that's never had media, before their first upload) -
 * a `list()`/`listAll()` failure at the scoped root is treated as "nothing
 * here yet" rather than propagated, since the delegate has no dedicated
 * "doesn't exist" signal a client-side caller can reliably distinguish from
 * other errors (see `http-source.ts`'s `parseJson`, which only ever surfaces
 * a plain `Error` with a message). A failure below the root still throws -
 * that's a real error worth surfacing. `upload` needs the same tolerance:
 * unlike `list`, the delegate's own route (`routes/storage.ts`'s
 * `handleUpload`) deliberately 404s an upload into a non-existent folder
 * (a real product rule for the plain Media browser), so a first upload at
 * the scoped root retries once after creating the missing path instead of
 * surfacing that 404 to the user.
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
    const scoped = all
      .filter((entry) => isInScope(folderPath, entry.id) && entry.id !== folderPath)
      .map((entry) => remapEntry(folderPath, entry));
    // New entries upload into a hidden `.tmp.*` scope. The storage tree
    // deliberately omits hidden folders, so a successful upload would look
    // empty here unless we list that exact scope directly.
    return scoped.length > 0 ? scoped : list(null);
  }

  const source: FileManagerSource = { scopeRoot: folderPath, list };
  if (delegate.listAll) source.listAll = listAll;

  if (delegate.upload) {
    const upload = delegate.upload;
    source.upload = async (folderId, files) => {
      const target = toAbsoluteId(folderPath, folderId);
      try {
        const entries = await upload(target, files);
        return entries.map((entry) => remapEntry(folderPath, entry));
      } catch (error) {
        // Only worth a retry at the scoped root itself, the one place the
        // folder is genuinely expected to not exist yet (see `list` above).
        // Uploading into a subfolder that's missing for real reasons should
        // still fail immediately.
        if (folderId !== null) throw error;
        await ensureFolderPath(delegate, folderPath);
        const entries = await upload(target, files);
        return entries.map((entry) => remapEntry(folderPath, entry));
      }
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
