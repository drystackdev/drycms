import type { FileEntry } from "../storage/entry-types.js";
import { encodePath } from "../storage/http-source.js";

export class PagesSourceApiError extends Error {}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const body = await readJson(res);
  throw new PagesSourceApiError(typeof body.message === "string" ? body.message : fallback);
}

/** Thin client-side fetch wrapper around `routes/pages-source.ts` - the one
 * client for everything in `pagesSourceStorage`, both source roots included
 * (`source-roots.ts`: `pages/**` and `component/**` are plain paths in the
 * same tree, not separate endpoints). Used by both `PageBuild.tsx`
 * (read-only: tree + file contents, to compile) and `PageEditor.tsx` (adds
 * the write calls below). */
export function createPagesSourceApi(baseUrl: string) {
  /** The whole pages-source tree, one round trip - `entries` is empty and
   * `supported: false` if the configured storage kind doesn't implement
   * `StorageAdapter.listAll` (only `local` does today; R2/S3 falls back to
   * `PageBuild.tsx`/`PageEditor.tsx`'s own per-folder `listAllFilesRecursive`). */
  async function listTree(): Promise<{ supported: boolean; entries: FileEntry[] }> {
    const res = await fetch(`${baseUrl}?tree`);
    await assertOk(res, "Failed to load the pages-source tree.");
    return res.json();
  }

  /** Raw `.tsx`/`.ts` source of one file. */
  async function read(path: string): Promise<string> {
    const res = await fetch(`${baseUrl}/${encodePath(path)}`);
    await assertOk(res, "Failed to load the file.");
    return res.text();
  }

  async function mkdir(parentPath: string, name: string): Promise<FileEntry> {
    const res = await fetch(`${baseUrl}${parentPath ? `/${encodePath(parentPath)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", name }),
    });
    await assertOk(res, "Failed to create the folder.");
    return (await res.json()).entry;
  }

  /** Create-or-overwrite `path`'s source. */
  async function save(path: string, code: string, baseSource?: string): Promise<FileEntry> {
    const headers: Record<string, string> = {};
    if (baseSource !== undefined) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(baseSource)));
      headers["X-Dry-Base-Source-Hash"] = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    const res = await fetch(`${baseUrl}/${encodePath(path)}`, {
      method: "PUT",
      headers,
      body: code,
    });
    await assertOk(res, "Failed to save the file.");
    return (await res.json()).entry;
  }

  async function move(from: string, to: string): Promise<FileEntry> {
    const res = await fetch(`${baseUrl}/${encodePath(from)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", to }),
    });
    await assertOk(res, "Failed to move/rename.");
    return (await res.json()).entry;
  }

  async function remove(path: string): Promise<void> {
    const res = await fetch(`${baseUrl}/${encodePath(path)}`, { method: "DELETE" });
    if (res.status === 204) return;
    await assertOk(res, "Failed to delete.");
  }

  return { listTree, read, mkdir, save, move, remove };
}

export type PagesSourceApi = ReturnType<typeof createPagesSourceApi>;
