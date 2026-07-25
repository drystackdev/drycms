import type { FileEntry, FileManagerSource } from "./file-manager-types.js";

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** `''` for the root - matches the `id`/`parentId` convention already used
 * by `FileEntry` (`null` = root) everywhere else in this file. */
function idFor(folderId: string | null): string {
  return folderId ?? "";
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Non-JSON error body - fall back to the status line.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

/**
 * The real backend: talks to `${apiBase}` (i.e. `${path}/api/storage`,
 * see `routes/storage.ts` for the contract) over `fetch`. Used by the
 * `Media` page - `mock/file-manager.ts`'s `createMemoryFileSource` is the
 * in-memory equivalent Showcase's demos use instead, so playing with those
 * never touches a real `storage/` folder.
 */
export function createHttpFileSource(apiBase: string): FileManagerSource {
  const urlFor = (id: string): string => {
    const encoded = encodePath(id);
    return encoded ? `${apiBase}/${encoded}` : apiBase;
  };

  async function list(folderId: string | null): Promise<FileEntry[]> {
    const response = await fetch(urlFor(idFor(folderId)));
    const data = await parseJson<{ entries: FileEntry[] }>(response);
    return data.entries;
  }

  /** `null` = the configured storage kind doesn't support a whole-tree
   * prefetch (see `routes/storage.ts`'s `?tree` handling) - `FileManager`
   * falls back to its per-folder `list()` in that case. */
  async function listAll(): Promise<FileEntry[] | null> {
    const response = await fetch(`${apiBase}?tree=1`);
    const data = await parseJson<{ supported: boolean; entries?: FileEntry[] }>(response);
    return data.supported ? (data.entries ?? []) : null;
  }

  async function upload(folderId: string | null, files: File[]): Promise<FileEntry[]> {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const response = await fetch(urlFor(idFor(folderId)), { method: "POST", body: form });
    const data = await parseJson<{ entries: FileEntry[] }>(response);
    return data.entries;
  }

  async function createFolder(folderId: string | null, name: string): Promise<FileEntry> {
    const response = await fetch(urlFor(idFor(folderId)), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", name }),
    });
    const data = await parseJson<{ entry: FileEntry }>(response);
    return data.entry;
  }

  async function moveOrCopyTo(
    action: "move" | "copy",
    id: string,
    to: string,
  ): Promise<Response> {
    return fetch(urlFor(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, to }),
    });
  }

  /** Ids in one batch always share a parent (selection never spans two open
   * folders), so their basenames are already distinct - safe to move in
   * parallel without risking a collision between the ids themselves. A
   * collision with something already at the destination still 409s, on
   * purpose (unlike `copy`, a move landing on an existing name is a real
   * conflict, not something to silently rename around). */
  async function move(ids: string[], targetFolderId: string | null): Promise<FileEntry[]> {
    const target = idFor(targetFolderId);
    return Promise.all(
      ids.map(async (id) => {
        const response = await moveOrCopyTo("move", id, joinPath(target, basename(id)));
        const data = await parseJson<{ entry: FileEntry }>(response);
        return data.entry;
      }),
    );
  }

  /** Sequential, unlike `move` - retries a colliding destination name
   * (`"name copy"`, `"name copy 2"`, ...) so copying into the same folder
   * (or copying the same batch twice) works the way a file explorer's
   * "Duplicate" does, instead of 409ing on the first collision. */
  async function copy(ids: string[], targetFolderId: string | null): Promise<FileEntry[]> {
    const target = idFor(targetFolderId);
    const results: FileEntry[] = [];
    for (const id of ids) results.push(await copyWithRetry(id, target));
    return results;
  }

  async function copyWithRetry(id: string, targetFolder: string): Promise<FileEntry> {
    const name = basename(id);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate =
        attempt === 0 ? name : `${stem} copy${attempt > 1 ? ` ${attempt}` : ""}${ext}`;
      const response = await moveOrCopyTo("copy", id, joinPath(targetFolder, candidate));
      if (response.status === 409) continue;
      const data = await parseJson<{ entry: FileEntry }>(response);
      return data.entry;
    }
    throw new Error(`Couldn't find a free name to copy "${name}" as.`);
  }

  async function remove(ids: string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const response = await fetch(urlFor(id), { method: "DELETE" });
        if (!response.ok) await parseJson(response); // throws with the server's message
      }),
    );
  }

  async function rename(id: string, name: string): Promise<FileEntry> {
    const response = await moveOrCopyTo("move", id, joinPath(dirname(id), name));
    const data = await parseJson<{ entry: FileEntry }>(response);
    return data.entry;
  }

  async function replace(id: string, file: File): Promise<FileEntry> {
    const response = await fetch(urlFor(id), {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await parseJson<{ entry: FileEntry }>(response);
    return data.entry;
  }

  return { list, listAll, upload, createFolder, move, copy, remove, rename, replace };
}
