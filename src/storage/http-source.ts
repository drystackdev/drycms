import { boxString, refOf } from "../content-types/dry-vei-ref.js";
import { adminPath } from "./admin-path.js";
import type { FileEntry, FileManagerSource } from "./entry-types.js";

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

export function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * Resolves an `image`-typed field's stored value into a servable `<img
 * src>`/`og:image` URL. The value is either a bare relative storage id
 * (e.g. "hero.jpg", resolved through the storage API) or a raw Link URL
 * typed in the picker's "Link" tab (already absolute/root-relative, stored
 * verbatim) - mirrors the admin's own resolution in `ContentEntryList.tsx`.
 * Lives here (not `src/apps/pages/lib`, its original home) so server-side
 * framework code (`app-router/render.ts`'s SEO tags) can use it too without
 * importing project page code.
 *
 * `basePath` defaults to `adminPath()` and exists for the one caller that
 * can't use it: the VEI overlay ships in the PUBLIC site bundle, where
 * `window.__DRY_CONFIG__` is never injected (only the admin app gets it, see
 * `server/client-config.ts`) - it reads the admin path out of its own
 * `#dry-vei-config` script instead and passes it in here.
 */
export function resolveImageSrc(value: string, basePath: string = adminPath()): string {
  const resolved =
    /^https?:\/\//i.test(value) || value.startsWith("/") ? String(value) : `${basePath}/api/storage/${encodePath(value)}`;
  // Carries the Visual Editing Interface's provenance across the rewrite, so
  // `<img src={imageUrl(post.hero)} />` still marks itself (`plans/vei.md`).
  // A `String.prototype` method would have dropped it - this is the one
  // helper in the repo that a stored image value routinely passes through.
  const ref = refOf(value);
  return ref ? boxString(resolved, ref) : resolved;
}

/**
 * Resolves an `icon`-typed field's stored value (a bare storage id under
 * `dry-icons/`, e.g. "dry-icons/solar-home-bold-duotone.svg") into a URL fit
 * for a CSS `mask-image`/`-webkit-mask` source. Icons are just SVG files
 * living in a `dry-icons/` subfolder of the same storage root `storage`
 * already serves publicly (see `options.ts`'s `resolveIconsOption`), so this
 * goes through the same `/api/storage/...` route `resolveImageSrc` does -
 * always via the `?preview` variant though, since a raw storage GET
 * force-downloads any `.svg` as `application/octet-stream`
 * (`routes/storage.ts`'s legacy-SVG guard) rather than serving it as a
 * directly usable `image/svg+xml` mask source.
 */
export function resolveIconSrc(value: string, basePath: string = adminPath()): string {
  const resolved =
    /^https?:\/\//i.test(value) || value.startsWith("/")
      ? String(value)
      : `${basePath}/api/storage/${encodePath(value)}?preview`;
  const ref = refOf(value);
  return ref ? boxString(resolved, ref) : resolved;
}

/**
 * The `<i style="...">` CSS-mask copy-paste snippet for an `icon`-typed
 * field's stored value - same mask technique `IconGlyph`/
 * `IconPreviewDialog.tsx`'s `maskSnippet` use, pointed at `resolveIconSrc`'s
 * URL instead of Iconify's hosted API (that one exists for icons not yet
 * imported into the local library; this is for one already picked on a
 * field).
 */
export function iconTagHtml(value: string, basePath?: string): string {
  const url = resolveIconSrc(value, basePath);
  return [
    "<i",
    ` style="display:inline-block;width:1em;height:1em;background-color:currentColor;`,
    `-webkit-mask:url('${url}') no-repeat center / contain;`,
    `mask:url('${url}') no-repeat center / contain;"`,
    "></i>",
  ].join("");
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
 * in-memory equivalent a test/demo can use instead, so playing with those
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

  async function importUrl(folderId: string | null, url: string): Promise<FileEntry> {
    const response = await fetch(urlFor(idFor(folderId)), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import-url", url }),
    });
    const data = await parseJson<{ entry: FileEntry }>(response);
    return data.entry;
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

  return { list, listAll, upload, importUrl, createFolder, move, copy, remove, rename, replace };
}
