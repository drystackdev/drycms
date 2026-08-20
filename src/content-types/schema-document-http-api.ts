const { path } = window.__DRY_CONFIG__;

/** `routes/content-type-document.ts` - `content/types.json` itself: its
 * staged `drafts` half (read/written by `draft-store.ts`), plus the
 * `/export` download and `/import` upload the Backup page offers. */
export const SCHEMA_DOCUMENT_ENDPOINT = `${path}/api/content-type-document`;
export const SCHEMA_DOCUMENT_EXPORT_ENDPOINT = `${SCHEMA_DOCUMENT_ENDPOINT}/export`;

export interface SchemaImportResult {
  ok: boolean;
  /** Names only - the caller reports counts, and a name is what an admin
   * recognizes in a toast. */
  added?: string[];
  updated?: string[];
  unchanged?: string[];
  reason?: string;
}

/**
 * Uploads an exported (or hand-written) content-type file and stages what's
 * in it as DRAFTS - it never migrates a table by itself. The admin then
 * reviews everything in Content Types -> "Apply and build", which already
 * dry-runs the migration and reports destructive changes before applying.
 *
 * Never throws: a network/HTTP failure comes back as `{ok:false,reason}`,
 * same contract `backup-http-api.ts` uses for its own calls.
 */
export async function importSchemaDocument(file: File): Promise<SchemaImportResult> {
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${SCHEMA_DOCUMENT_ENDPOINT}/import`, {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    const body = (await response.json().catch(() => ({}))) as {
      message?: unknown;
      added?: string[];
      updated?: string[];
      unchanged?: string[];
    };
    if (!response.ok) {
      return { ok: false, reason: typeof body.message === "string" ? body.message : `HTTP ${response.status}` };
    }
    return { ok: true, added: body.added ?? [], updated: body.updated ?? [], unchanged: body.unchanged ?? [] };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Request failed." };
  }
}
