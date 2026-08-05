import type { FileEntry } from "../storage/entry-types.js";
import { slugify } from "../lib/slugify.js";

export interface IconEntry extends FileEntry {
  url: string;
}

export interface ListIconsResult {
  total: number;
  entries: IconEntry[];
}

export interface SkippedIcon {
  name: string;
  reason: string;
}

export interface ImportResult {
  created: IconEntry[];
  skipped: SkippedIcon[];
}

export class IconsApiError extends Error {}

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
  throw new IconsApiError(typeof body.message === "string" ? body.message : fallback);
}

/** Thin client-side fetch wrapper around `routes/icons.ts`, mirroring
 * `content-types/http-api.ts`'s role for the content-type API. */
export function createIconsApi(baseUrl: string) {
  async function list(options: { page?: number; pageSize?: number; search?: string } = {}): Promise<ListIconsResult> {
    const params = new URLSearchParams();
    if (options.page !== undefined) params.set("page", String(options.page));
    if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
    if (options.search) params.set("search", options.search);
    const qs = params.toString();
    const res = await fetch(qs ? `${baseUrl}?${qs}` : baseUrl);
    await assertOk(res, "Failed to list icons.");
    return res.json();
  }

  /** Raw SVG source text, for prefilling the manual edit form. */
  async function get(name: string): Promise<string> {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(name)}`);
    await assertOk(res, "Failed to load icon.");
    return res.text();
  }

  async function create(input: { name: string; svg: string }): Promise<IconEntry> {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name: input.name, svg: input.svg }),
    });
    await assertOk(res, "Failed to create icon.");
    return (await res.json()).entry;
  }

  /** Renames first (only if the label produces a different filename, via the
   * same `slugify` the server uses for a fresh `create`) and then always
   * overwrites the content - one uniform path for "renamed", "content
   * changed", and "both", rather than three. */
  async function save(input: { originalName: string; name: string; svg: string }): Promise<IconEntry> {
    const newFilename = `${slugify(input.name)}.svg`;
    let targetName = input.originalName;
    if (newFilename !== input.originalName) {
      const renamed = await fetch(`${baseUrl}/${encodeURIComponent(input.originalName)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", to: newFilename }),
      });
      await assertOk(renamed, "Failed to rename icon.");
      targetName = newFilename;
    }
    const res = await fetch(`${baseUrl}/${encodeURIComponent(targetName)}`, {
      method: "PUT",
      body: input.svg,
    });
    await assertOk(res, "Failed to save icon.");
    return (await res.json()).entry;
  }

  async function remove(name: string): Promise<void> {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (res.status === 204) return;
    await assertOk(res, "Failed to delete icon.");
  }

  async function importFromIconify(input: { prefix: string; names: string[] }): Promise<ImportResult> {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import", prefix: input.prefix, names: input.names }),
    });
    await assertOk(res, "Failed to import icons.");
    return res.json();
  }

  return { list, get, create, save, remove, importFromIconify };
}

export type IconsApi = ReturnType<typeof createIconsApi>;
