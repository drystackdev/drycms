export interface EntrySummary {
  /** Already-hashed (see `lib/id-hash.ts`) - never a raw DB integer. */
  id: string;
  value: Record<string, unknown>;
}

export interface EntryListQuery {
  page: number;
  pageSize: number;
  sortField?: string;
  sortDir?: "asc" | "desc";
  search?: string;
  searchableFields?: string[];
}

export interface EntryListResult {
  rows: EntrySummary[];
  total: number;
}

export class ContentEntriesApiError extends Error {
  /** Field name (dotted path for nested `flatten` fields) -> message, set
   * only for a 422 validation failure - see `routes/content-entries.ts`. */
  fieldErrors?: Record<string, string>;

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
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
  throw new ContentEntriesApiError(typeof body.message === "string" ? body.message : fallback, body.fieldErrors);
}

/** Thin client-side fetch wrapper around `routes/content-entries.ts`,
 * mirroring `content-types/http-api.ts`'s role for the schema API - one
 * instance is scoped to a single content type's own entries (`typeSlug` is
 * `ContentTypeDefinition.name`, e.g. `"user"`). */
export function createContentEntriesApi(baseUrl: string, typeSlug: string) {
  const typeUrl = `${baseUrl}/${encodeURIComponent(typeSlug)}`;

  async function list(query: EntryListQuery): Promise<EntryListResult> {
    const params = new URLSearchParams();
    params.set("page", String(query.page));
    params.set("pageSize", String(query.pageSize));
    if (query.sortField) params.set("sortField", query.sortField);
    if (query.sortDir) params.set("sortDir", query.sortDir);
    if (query.search) params.set("search", query.search);
    if (query.searchableFields && query.searchableFields.length > 0) {
      params.set("searchableFields", query.searchableFields.join(","));
    }
    const res = await fetch(`${typeUrl}?${params.toString()}`);
    await assertOk(res, "Failed to list entries.");
    return res.json();
  }

  async function get(id: string): Promise<EntrySummary> {
    const res = await fetch(`${typeUrl}/${encodeURIComponent(id)}`);
    await assertOk(res, "Failed to load entry.");
    return (await res.json()).entry;
  }

  /** `singleton` types only - the one entry, or `null` before it's ever been saved. */
  async function getSingleton(): Promise<EntrySummary | null> {
    const res = await fetch(typeUrl);
    await assertOk(res, "Failed to load entry.");
    return (await res.json()).entry;
  }

  async function create(value: Record<string, unknown>): Promise<EntrySummary> {
    const res = await fetch(typeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    await assertOk(res, "Failed to create entry.");
    return (await res.json()).entry;
  }

  async function update(id: string, value: Record<string, unknown>): Promise<EntrySummary> {
    const res = await fetch(`${typeUrl}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    await assertOk(res, "Failed to update entry.");
    return (await res.json()).entry;
  }

  /** `singleton` types only - creates the row on first save, updates it after. */
  async function saveSingleton(value: Record<string, unknown>): Promise<EntrySummary> {
    const res = await fetch(typeUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    await assertOk(res, "Failed to save entry.");
    return (await res.json()).entry;
  }

  async function remove(id: string): Promise<void> {
    const res = await fetch(`${typeUrl}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.status === 204) return;
    await assertOk(res, "Failed to delete entry.");
  }

  return { list, get, getSingleton, create, update, saveSingleton, remove };
}

export type ContentEntriesApi = ReturnType<typeof createContentEntriesApi>;
