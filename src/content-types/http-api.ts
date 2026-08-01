import type { AnyDestructiveChange } from "./engine/types.js";
import type { ContentTypeDefinition, ContentTypeKind } from "./types.js";

export interface SaveResponse {
  requiresConfirm?: true;
  destructiveSummary?: AnyDestructiveChange[];
  definition?: ContentTypeDefinition;
}

export interface BatchItemResult {
  id: string;
  label: string;
  kind: ContentTypeKind;
  ok: boolean;
  destructiveSummary?: AnyDestructiveChange[];
  error?: string;
}

export interface BatchResponse {
  mode: "plan" | "apply";
  results: BatchItemResult[];
}

export class ContentTypesApiError extends Error {}

/** Same envelope shape `entries-http-api.ts`'s `VersionedResult` uses - see
 * `status/build-cache.md`. */
export interface VersionedResult<T> {
  changed: boolean;
  version: number;
  data?: T;
}

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

  /** "Apply and build" (see `status/content-type-staged-apply.md`) - shares
   * the collection endpoint (POST) with `create()`, distinguished server-side
   * by sending `drafts[]` instead of a single `definition`. `mode: "plan"` is
   * a pure dry-run (no writes); `mode: "apply"` actually runs the migrations,
   * sequentially, stopping at the first failure. */
  async function planBatch(drafts: ContentTypeDefinition[]): Promise<BatchResponse> {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "plan", drafts: drafts.map((definition) => ({ definition })) }),
    });
    await assertOk(res, "Failed to check pending changes.");
    return res.json();
  }

  async function applyBatch(drafts: ContentTypeDefinition[]): Promise<BatchResponse> {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "apply", drafts: drafts.map((definition) => ({ definition })) }),
    });
    await assertOk(res, "Failed to apply pending changes.");
    return res.json();
  }

  async function remove(id: string): Promise<void> {
    const res = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.status === 204) return;
    await assertOk(res, "Failed to delete content type.");
  }

  /** `useFetch()`-oriented counterpart to `list()` - sends `ifVersion` as
   * `X-Data-Version`, returns the `changed`/`version` envelope instead of
   * the bare array (see `status/build-cache.md`). */
  async function listVersioned(ifVersion?: number, signal?: AbortSignal): Promise<VersionedResult<ContentTypeDefinition[]>> {
    const res = await fetch(baseUrl, {
      headers: ifVersion === undefined ? undefined : { "X-Data-Version": String(ifVersion) },
      signal,
    });
    await assertOk(res, "Failed to list content types.");
    const body = await res.json();
    return body.changed ? { changed: true, version: body.version, data: body.definitions } : { changed: false, version: body.version };
  }

  return { list, get, create, update, remove, listVersioned, planBatch, applyBatch };
}

export type ContentTypesApi = ReturnType<typeof createContentTypesApi>;
