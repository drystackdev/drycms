import type { FileEntry, FileManagerSource } from "../components/file-manager-types.js";
import { isHiddenEntry } from "../components/file-manager-utils.js";

function extOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

function joinPath(parent: string | null, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * Flat seed dataset for the FileManager showcase - a few root folders (one
 * nested two levels deep, for breadcrumb + move/copy folder-tree testing)
 * plus a spread of files covering every thumbnail category. `id`/`parentId`
 * are real paths, same convention the HTTP-backed source uses, so Showcase's
 * demos exercise the exact same `FileManager` code paths the real Media page
 * does.
 */
const defaultSeed: FileEntry[] = [
  // --- Root folders (size/fileCount are illustrative, matching the reference screenshot)
  { id: "Docs", name: "Docs", parentId: null, kind: "folder", size: 2_405_181_686, modifiedAt: "2026-07-25T16:50:00", fileCount: 100 },
  { id: "Foods", name: "Foods", parentId: null, kind: "folder", size: 400_022_651, modifiedAt: "2026-07-20T11:50:00", fileCount: 600 },
  { id: "Projects", name: "Projects", parentId: null, kind: "folder", size: 1_202_590_843, modifiedAt: "2026-07-24T15:50:00", fileCount: 200 },
  { id: "Sport", name: "Sport", parentId: null, kind: "folder", size: 480_024_207, modifiedAt: "2026-07-21T12:50:00", fileCount: 150 },
  { id: "Training", name: "Training", parentId: null, kind: "folder", size: 600_015_258, modifiedAt: "2026-07-22T13:50:00", fileCount: 80 },
  { id: "Work", name: "Work", parentId: null, kind: "folder", size: 800_116_439, modifiedAt: "2026-07-23T14:50:00", fileCount: 220 },

  // --- Root files
  { id: "cover-2.jpg", name: "cover-2.jpg", parentId: null, kind: "file", ext: "jpg", size: 47_984_640, modifiedAt: "2026-07-25T16:50:00" },
  { id: "cover-12.jpg", name: "cover-12.jpg", parentId: null, kind: "file", ext: "jpg", size: 2_181_038, modifiedAt: "2026-07-03T19:50:00" },
  { id: "cover-18.jpg", name: "cover-18.jpg", parentId: null, kind: "file", ext: "jpg", size: 2_086_549, modifiedAt: "2026-07-02T18:50:00" },
  { id: "report.pdf", name: "report.pdf", parentId: null, kind: "file", ext: "pdf", size: 812_450, modifiedAt: "2026-07-19T09:12:00" },
  { id: "archive.zip", name: "archive.zip", parentId: null, kind: "file", ext: "zip", size: 15_728_640, modifiedAt: "2026-07-11T14:02:00" },
  { id: "notes.txt", name: "notes.txt", parentId: null, kind: "file", ext: "txt", size: 4_096, modifiedAt: "2026-07-15T08:30:00" },
  { id: "podcast.mp3", name: "podcast.mp3", parentId: null, kind: "file", ext: "mp3", size: 9_437_184, modifiedAt: "2026-07-05T21:10:00" },
  { id: "intro.mp4", name: "intro.mp4", parentId: null, kind: "file", ext: "mp4", size: 104_857_600, modifiedAt: "2026-07-08T17:45:00" },
  { id: "brand-guide.ai", name: "brand-guide.ai", parentId: null, kind: "file", ext: "ai", size: 6_291_456, modifiedAt: "2026-07-09T10:00:00" },
  { id: "mockup.psd", name: "mockup.psd", parentId: null, kind: "file", ext: "psd", size: 41_943_040, modifiedAt: "2026-07-14T13:25:00" },
  { id: "budget.xlsx", name: "budget.xlsx", parentId: null, kind: "file", ext: "xlsx", size: 98_304, modifiedAt: "2026-07-17T11:40:00" },
  { id: "proposal.docx", name: "proposal.docx", parentId: null, kind: "file", ext: "docx", size: 235_520, modifiedAt: "2026-07-16T15:05:00" },
  { id: "deck.pptx", name: "deck.pptx", parentId: null, kind: "file", ext: "pptx", size: 3_145_728, modifiedAt: "2026-07-18T16:20:00" },

  // --- Inside "Docs"
  { id: "Docs/contract.docx", name: "contract.docx", parentId: "Docs", kind: "file", ext: "docx", size: 184_320, modifiedAt: "2026-07-20T09:00:00" },
  { id: "Docs/invoice.pdf", name: "invoice.pdf", parentId: "Docs", kind: "file", ext: "pdf", size: 92_160, modifiedAt: "2026-07-21T09:30:00" },
  { id: "Docs/readme.txt", name: "readme.txt", parentId: "Docs", kind: "file", ext: "txt", size: 1_024, modifiedAt: "2026-07-19T09:00:00" },

  // --- Inside "Projects"
  { id: "Projects/Website", name: "Website", parentId: "Projects", kind: "folder", size: 12_058_624, modifiedAt: "2026-07-23T10:00:00", fileCount: 2 },
  { id: "Projects/roadmap.xlsx", name: "roadmap.xlsx", parentId: "Projects", kind: "file", ext: "xlsx", size: 65_536, modifiedAt: "2026-07-22T10:15:00" },

  // --- Inside "Projects/Website"
  { id: "Projects/Website/index-design.ai", name: "index-design.ai", parentId: "Projects/Website", kind: "file", ext: "ai", size: 8_388_608, modifiedAt: "2026-07-23T11:00:00" },
  { id: "Projects/Website/hero.jpg", name: "hero.jpg", parentId: "Projects/Website", kind: "file", ext: "jpg", size: 3_670_016, modifiedAt: "2026-07-23T11:05:00" },
];

/**
 * In-memory `FileManagerSource` - Showcase's demos use this instead of
 * `createHttpFileSource` so poking at them never touches a real `storage/`
 * folder. Each call gets its own private copy of `seed`, matching how every
 * `<FileManager>` instance used to keep its own local copy of the old flat
 * `data` array.
 *
 * Mirrors the real backend's rules, not just its `FileEntry` shape: `id` is
 * a path (so move/copy/rename resolve collisions and rewrite descendant
 * paths the same way `routes/storage.ts` does), and a newly created folder
 * gets a hidden `.dir` marker child (see `isHiddenEntry`) so an "empty"
 * folder is represented the same way it is for `local` storage.
 */
export function createMemoryFileSource(seed: FileEntry[] = defaultSeed): FileManagerSource {
  let entries = seed.map((entry) => ({ ...entry }));

  function children(folderId: string | null): FileEntry[] {
    return entries.filter((entry) => entry.parentId === folderId);
  }

  /** `id` plus every entry nested under it (folders included, recursively). */
  function descendantIds(id: string): Set<string> {
    const collected = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of entries) {
        if (child.parentId === current && !collected.has(child.id)) {
          collected.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return collected;
  }

  /** First choice if free, else `"name copy"`, `"name copy 2"`, ... - used
   * by copy (which should always find a landing spot) and by upload/mkdir
   * (whose target folder was just listed, so a collision here means a
   * concurrent change - equally reasonable to just land next to it). */
  function findFreeName(folderId: string | null, name: string): string {
    const taken = new Set(children(folderId).map((entry) => entry.name));
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let attempt = 1; attempt < 100; attempt++) {
      const candidate = `${stem} copy${attempt > 1 ? ` ${attempt}` : ""}${ext}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new Error(`Couldn't find a free name for "${name}".`);
  }

  /** `id`'s subtree (itself included), rebuilt as if it now lived under
   * `newParentId` with leaf name `newName` - every descendant's `id`/
   * `parentId` prefix is rewritten to match. Used by both move (the
   * original subtree is then discarded) and copy (it's kept, and this
   * becomes a second, independent tree). */
  function retarget(
    id: string,
    newParentId: string | null,
    newName: string,
  ): { top: FileEntry; subtree: FileEntry[] } {
    const source = entries.find((entry) => entry.id === id);
    if (!source) throw new Error(`"${id}" no longer exists.`);
    const newId = joinPath(newParentId, newName);
    const top: FileEntry = { ...source, id: newId, parentId: newParentId, name: newName };
    const subtree: FileEntry[] = [top];
    if (source.kind === "folder") {
      for (const child of entries.filter((entry) => entry.parentId === id)) {
        subtree.push(...retarget(child.id, newId, child.name).subtree);
      }
    }
    return { top, subtree };
  }

  /** Shared by `move` (same name, new parent) and `rename` (new name, same
   * parent) - a collision at the destination is a hard error for both,
   * unlike `copy`'s auto-suffix (matches `createHttpFileSource`, which is
   * bound by the same 409-on-collision rule from `routes/storage.ts`). */
  function moveOne(id: string, targetFolderId: string | null, newName?: string): FileEntry {
    const source = entries.find((entry) => entry.id === id);
    if (!source) throw new Error(`"${id}" no longer exists.`);
    const name = newName ?? source.name;
    const newId = joinPath(targetFolderId, name);
    if (newId !== id && entries.some((entry) => entry.id === newId)) {
      throw new Error(`"${name}" already exists.`);
    }

    const { top, subtree } = retarget(id, targetFolderId, name);
    const oldSubtreeIds = descendantIds(id);
    entries = [...entries.filter((entry) => !oldSubtreeIds.has(entry.id)), ...subtree];
    return { ...top };
  }

  function copyOne(id: string, targetFolderId: string | null): FileEntry {
    const source = entries.find((entry) => entry.id === id);
    if (!source) throw new Error(`"${id}" no longer exists.`);
    const name = findFreeName(targetFolderId, source.name);
    const { top, subtree } = retarget(id, targetFolderId, name);
    entries = [...entries, ...subtree];
    return { ...top };
  }

  async function list(folderId: string | null): Promise<FileEntry[]> {
    return children(folderId)
      .filter((entry) => !isHiddenEntry(entry))
      .map((entry) => ({ ...entry }));
  }

  /** Exercises the same `FileManager` tree-prefetch path the real `local`/
   * `github` backends use - trivial here since everything already lives in
   * memory. */
  async function listAll(): Promise<FileEntry[]> {
    return entries.filter((entry) => !isHiddenEntry(entry)).map((entry) => ({ ...entry }));
  }

  async function upload(folderId: string | null, files: File[]): Promise<FileEntry[]> {
    const additions = files.map((file): FileEntry => {
      const name = findFreeName(folderId, file.name);
      return {
        id: joinPath(folderId, name),
        name,
        parentId: folderId,
        kind: "file",
        ext: extOf(name),
        size: file.size,
        modifiedAt: new Date().toISOString(),
        previewUrl: isImageFile(file) ? URL.createObjectURL(file) : undefined,
      };
    });
    entries = [...entries, ...additions];
    return additions.map((entry) => ({ ...entry }));
  }

  async function createFolder(folderId: string | null, name: string): Promise<FileEntry> {
    const finalName = findFreeName(folderId, name);
    const id = joinPath(folderId, finalName);
    const now = new Date().toISOString();
    const folder: FileEntry = {
      id,
      name: finalName,
      parentId: folderId,
      kind: "folder",
      size: 0,
      fileCount: 0,
      modifiedAt: now,
    };
    const marker: FileEntry = {
      id: joinPath(id, ".dir"),
      name: ".dir",
      parentId: id,
      kind: "file",
      size: 0,
      modifiedAt: now,
    };
    entries = [...entries, folder, marker];
    return { ...folder };
  }

  async function move(ids: string[], targetFolderId: string | null): Promise<FileEntry[]> {
    return ids.map((id) => moveOne(id, targetFolderId));
  }

  async function copy(ids: string[], targetFolderId: string | null): Promise<FileEntry[]> {
    return ids.map((id) => copyOne(id, targetFolderId));
  }

  async function remove(ids: string[]): Promise<void> {
    const toRemove = new Set<string>();
    for (const id of ids) for (const descendant of descendantIds(id)) toRemove.add(descendant);
    entries = entries.filter((entry) => !toRemove.has(entry.id));
  }

  async function rename(id: string, name: string): Promise<FileEntry> {
    const source = entries.find((entry) => entry.id === id);
    if (!source) throw new Error(`"${id}" no longer exists.`);
    return moveOne(id, source.parentId, name);
  }

  async function replace(id: string, file: File): Promise<FileEntry> {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) throw new Error(`"${id}" no longer exists.`);
    const updated: FileEntry = {
      ...entries[index]!,
      size: file.size,
      modifiedAt: new Date().toISOString(),
      previewUrl: isImageFile(file) ? URL.createObjectURL(file) : entries[index]!.previewUrl,
    };
    entries = entries.map((entry, i) => (i === index ? updated : entry));
    return { ...updated };
  }

  return { list, listAll, upload, createFolder, move, copy, remove, rename, replace };
}
