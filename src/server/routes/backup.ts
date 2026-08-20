import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { content } from "../config.js";
import { requireSuperAdmin } from "../admin-access.js";
import { jsonResponse } from "../route-helpers.js";
import { invalidateSchemaCache } from "../content-adapters.js";
import { resolveSqliteDriver } from "../../content-types/engine/sqlite-driver.js";
import type { D1Database } from "../../content-types/engine/d1-driver.js";
import {
  buildSqlDump,
  d1RawHandle,
  parseSqlDump,
  restoreFromDump,
  sqliteRawHandle,
  type RawSqlHandle,
} from "../../content-types/engine/backup.js";
import { ContentEngineError } from "../../content-types/engine/types.js";
import { createStorageSchemaDocumentStore } from "../schema-document-storage.js";
import { parseSchemaDocument, type SchemaDocument } from "../../content-types/schema-document.js";
import { loadGithubSyncConfig } from "./pages-source-github-sync.js";
import { pullEntriesFromGit } from "../git-restore.js";

const STATUS_BY_CODE: Record<string, number> = {
  invalid_definition: 400,
  unsupported: 501,
};

function errorResponse(error: unknown): Response {
  if (error instanceof ContentEngineError) {
    return jsonResponse({ error: error.code, message: error.message }, STATUS_BY_CODE[error.code] ?? 500);
  }
  console.error("[drycms] backup route error", error);
  return jsonResponse({ error: "internal", message: "Internal server error." }, 500);
}

/** Mirrors `engine/d1.ts`'s own binding lookup - kept as its own copy since
 * this route talks to the raw `D1Database` directly (via `backup.ts`'s
 * `RawSqlHandle`), not through a `ContentEngineAdapter`. */
async function resolveRawHandle(context: DryRouteContext): Promise<RawSqlHandle> {
  if (content.engine === "D1") {
    const db = context.env[content.binding] as D1Database | undefined;
    if (!db) {
      throw new ContentEngineError(
        "unsupported",
        `[drycms] D1 binding "${content.binding}" was not found on the request env - check wrangler.jsonc's d1_databases config.`,
      );
    }
    return d1RawHandle(db);
  }
  return sqliteRawHandle(await resolveSqliteDriver(content.file));
}

function backupFileTimestamp(): string {
  return new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
}

/**
 * `GET {path}/api/backup` - downloads the whole content database (schema +
 * every content-type/entry/role/system-settings/pages-registry row -
 * `CLAUDE.md`'s own note that `.dry/content.sqlite`/D1's `CONTENT_DB` is one
 * physical database covering all of it) as a portable `.sql` script. Both
 * `content.engine` values produce the exact same script format: a live
 * local SQLite file can't safely be swapped out from under the long-lived
 * connections `content-adapters.ts` already holds open (and D1 has no raw
 * file to begin with - it's a remote binding), so backup/restore goes
 * through this one script format for both engines rather than a raw file
 * copy for one and a dump for the other.
 */
/**
 * The content types themselves are no longer in the database - they live in
 * `content/types.json` (`content-types/schema-document.ts`) - so a dump of
 * the tables alone would restore rows whose schema nothing describes. The
 * whole document rides along as ONE marker comment line at the top of the
 * same `.sql` file, keeping backup/restore a single file for the admin and
 * leaving the script itself valid SQL. A backup taken before this existed
 * simply has no marker, and restoring it leaves the current document alone.
 */
const SCHEMA_MARKER = "-- drycms:content-types ";

function readSchemaMarker(dump: string): SchemaDocument | null {
  const line = dump.split("\n").find((candidate) => candidate.startsWith(SCHEMA_MARKER));
  if (!line) return null;
  try {
    return parseSchemaDocument(line.slice(SCHEMA_MARKER.length));
  } catch {
    // A corrupt marker must not cost the admin the table restore itself -
    // the tables are the irreplaceable half, the document can be re-applied
    // from git or re-edited.
    return null;
  }
}

/**
 * `GET {path}/api/backup/entries` - reports whether this branch has a git
 * repository configured, so `Backup.tsx`'s "Entry" section knows whether to
 * offer the pull at all (`pullEntriesFromGit` needs a repo to read `content/
 * entries/**` from - there is nothing to preview/pull without one).
 */
async function getEntryPullStatus(context: DryRouteContext): Promise<Response> {
  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ configured: false, reason: loaded.error });
  return jsonResponse({ configured: true, repo: loaded.config.repo, branch: loaded.config.branch, provider: loaded.config.provider });
}

/**
 * `POST {path}/api/backup/entries` - `{ mode: "plan" | "apply" }`. The
 * reverse of the whole-database restore above: instead of a `.sql` file the
 * admin uploads, this pulls whatever `content/entries/**` already holds at
 * this branch's git HEAD (`pullEntriesFromGit`) and writes it into the
 * current install's live database - e.g. hydrating a freshly cloned branch's
 * local sqlite, which never received those rows. `mode: "plan"` (the
 * default) writes nothing and just reports how many entries would be pulled.
 */
async function postEntryPull(context: DryRouteContext): Promise<Response> {
  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ error: "git_not_configured", message: loaded.error }, 412);
  const body = (await context.request.json().catch(() => ({}))) as { mode?: unknown };
  const mode = body.mode === "apply" ? "apply" : "plan";
  const outcome = await pullEntriesFromGit(context, loaded.config, { mode });
  if (!outcome.ok) return jsonResponse({ error: "git_error", message: outcome.reason }, 502);
  if (content.engine === "D1" && outcome.result.applied) await invalidateSchemaCache(context);
  return jsonResponse({ mode, ...outcome.result });
}

export const GET: DryRouteHandler = async (context) => {
  const denied = await requireSuperAdmin(context, "Only Super Admin can back up the database.");
  if (denied) return denied;
  if ((context.params.slug ?? "") === "entries") return getEntryPullStatus(context);
  try {
    const handle = await resolveRawHandle(context);
    const document = await createStorageSchemaDocumentStore(context).read();
    const tables = await buildSqlDump(handle);
    const dump = document
      ? `${SCHEMA_MARKER}${JSON.stringify(document)}\n${tables}`
      : tables;
    return new Response(dump, {
      status: 200,
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="drycms-backup-${backupFileTimestamp()}.sql"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

/**
 * `POST {path}/api/backup` - restores a `.sql` backup previously downloaded
 * from this same `GET`: every current real table is dropped and recreated
 * from the uploaded script, so this is a full replace, not a merge -
 * anything created/changed since that backup was taken is permanently lost,
 * including the signed-in Super Admin's own `user`/`role` row if the backup
 * predates it. The client warns and requires a typed confirmation before
 * calling this; nothing here double-checks that the caller's own session
 * survives the restore.
 */
export const POST: DryRouteHandler = async (context) => {
  const denied = await requireSuperAdmin(context, "Only Super Admin can restore the database.");
  if (denied) return denied;
  if ((context.params.slug ?? "") === "entries") return postEntryPull(context);
  try {
    const form = await context.request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ContentEngineError("invalid_definition", "A backup file is required.");
    }
    const text = await file.text();
    const document = readSchemaMarker(text);
    const statements = parseSqlDump(text);
    if (statements.length === 0) {
      throw new ContentEngineError("invalid_definition", "The backup file has no statements to restore.");
    }
    const handle = await resolveRawHandle(context);
    const restoredRows = await restoreFromDump(handle, statements);
    // Document after tables, same order `applySave` uses: the schema
    // description only ever advances to something the database already has.
    if (document) await createStorageSchemaDocumentStore(context).write(document);
    // Raw-SQL restore bypasses every write path (`applySave`, entry CRUD)
    // the isolate/KV schema cache normally invalidates itself off of - clear
    // it explicitly so the next request sees the restored data immediately
    // instead of up to 30s of stale content-types/roles/system-settings.
    if (content.engine === "D1") await invalidateSchemaCache(context);
    return jsonResponse({ applied: true, restoredRows });
  } catch (error) {
    return errorResponse(error);
  }
};
