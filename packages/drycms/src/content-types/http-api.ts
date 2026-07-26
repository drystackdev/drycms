import type { DestructiveChange } from "./migration.js";
import type { ContentTypeDefinition } from "./types.js";

export interface SaveResponse {
  requiresConfirm?: true;
  destructiveSummary?: DestructiveChange[];
  definition?: ContentTypeDefinition;
}

export class ContentTypesApiError extends Error {}

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
  throw new ContentTypesApiError(typeof body.message === "string" ? body.message : fallback);
}

/** Thin client-side fetch wrapper around `routes/content-types.ts`, mirroring
 * `file-manager-http-source.ts`'s role for the storage API. */
export function createContentTypesApi(baseUrl: string) {
  async function list(): Promise<ContentTypeDefinition[]> {
    const res = await fetch(baseUrl);
    await assertOk(res, "Failed to list content types.");
    return (await res.json()).definitions;
  }

  async function get(id: string): Promise<ContentTypeDefinition> {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(id)}`);
    await assertOk(res, "Failed to load content type.");
    return (await res.json()).definition;
  }

  async function create(definition: ContentTypeDefinition, confirm = false): Promise<SaveResponse> {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition, confirm }),
    });
    await assertOk(res, "Failed to create content type.");
    return res.json();
  }

  async function update(definition: ContentTypeDefinition, confirm = false): Promise<SaveResponse> {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(definition.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition, confirm }),
    });
    await assertOk(res, "Failed to update content type.");
    return res.json();
  }

  async function remove(id: string): Promise<void> {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.status === 204) return;
    await assertOk(res, "Failed to delete content type.");
  }

  return { list, get, create, update, remove };
}

export type ContentTypesApi = ReturnType<typeof createContentTypesApi>;
