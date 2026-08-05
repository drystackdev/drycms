import type { FileEntry } from "../storage/entry-types.js";
import { encodePath } from "../storage/http-source.js";

export class PageComponentsApiError extends Error {}

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
  throw new PageComponentsApiError(typeof body.message === "string" ? body.message : fallback);
}

/** Thin client-side fetch wrapper around `routes/page-components.ts`,
 * mirroring `icons/icons-http-api.ts`'s role for the icons API. */
export function createPageComponentsApi(baseUrl: string) {
  /** The whole component tree, one round trip - `entries` is empty and
   * `supported: false` if the configured storage kind doesn't implement
   * `StorageAdapter.listAll` (only `local` does today). */
  async function listTree(): Promise<{ supported: boolean; entries: FileEntry[] }> {
    const res = await fetch(`${baseUrl}?tree`);
    await assertOk(res, "Failed to load the component tree.");
    return res.json();
  }

  /** Raw `.tsx`/`.ts` source of one file. */
  async function read(path: string): Promise<string> {
    const res = await fetch(`${baseUrl}/${encodePath(path)}`);
    await assertOk(res, "Failed to load the component.");
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
  async function save(path: string, code: string): Promise<FileEntry> {
    const res = await fetch(`${baseUrl}/${encodePath(path)}`, {
      method: "PUT",
      body: code,
    });
    await assertOk(res, "Failed to save the component.");
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

export type PageComponentsApi = ReturnType<typeof createPageComponentsApi>;
