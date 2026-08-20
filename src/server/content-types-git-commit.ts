import type { DryRouteContext } from "./context.js";
import { loadGithubSyncConfig } from "./routes/pages-source-github-sync.js";
import { commitContentChanges } from "./git-source-sync.js";
import { createStorageSchemaDocumentStore } from "./schema-document-storage.js";
import { SCHEMA_DOCUMENT_PATH, serializeSchemaDocument } from "../content-types/schema-document.js";

export interface SchemaCommitResult {
  committed: boolean;
  commitSha?: string;
  reason?: string;
}

/**
 * Commits `content/types.json` - the whole content-type schema - to the
 * configured git repository, right after an apply/delete has already
 * succeeded (`status/content-types-json-file.md`).
 *
 * The SERVER does this, not the browser, for the same reason it owns the
 * apply itself: the document and the real tables have to move together, and
 * only the server has just written both. It is deliberately best-effort -
 * a repo that isn't configured, a bad token, or a `custom` (self-hosted) git
 * host with no REST API all come back as `{ committed: false, reason }` and
 * never fail the schema change that already landed. The commit that carries
 * the change is the record; the storage copy is what serves requests.
 *
 * Message is `[CONTENT] `-prefixed so `HistoryDialog.tsx`'s Content tab
 * buckets it exactly like an entry change (`routes/content-history.ts`).
 */
export async function commitSchemaDocument(
  context: DryRouteContext,
  summary: { verb: string; labels: string[] },
): Promise<SchemaCommitResult> {
  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return { committed: false, reason: loaded.error };

  const document = await createStorageSchemaDocumentStore(context).read();
  if (!document) return { committed: false, reason: "The content type document does not exist yet." };

  const { verb, labels } = summary;
  const what = labels.length === 0
    ? "content types"
    : labels.length <= 3
      ? labels.join(", ")
      : `${labels.length} content types`;
  const author = {
    name: context.session?.name || "drycms",
    email: `${context.session?.id ?? "admin"}@content-history.drycms`,
  };

  const result = await commitContentChanges(
    loaded.config,
    { [SCHEMA_DOCUMENT_PATH]: serializeSchemaDocument(document) },
    `[CONTENT] ${verb} ${what}`,
    author,
  );
  return result.ok ? { committed: true, commitSha: result.commitSha } : { committed: false, reason: result.reason };
}
