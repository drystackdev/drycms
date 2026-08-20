import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { content, storage } from "../config.js";
import { requireSuperAdmin } from "../admin-access.js";
import { jsonResponse } from "../route-helpers.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { invalidateSchemaCache } from "../content-adapters.js";
import { createStorageSchemaDocumentStore } from "../schema-document-storage.js";
import { emptySchemaDocument, withAppliedType } from "../../content-types/schema-document.js";
import { pendingSeed } from "../../content-types/seed.js";
import { resolveSqliteDriver } from "../../content-types/engine/sqlite-driver.js";
import { bootstrapDefaultContentSchema } from "../../content-types/engine/sqlite.js";
import type { D1Database } from "../../content-types/engine/d1-driver.js";
import {
  buildSqlDump,
  d1RawHandle,
  parseSqlDump,
  restoreFromDump,
  sqlLiteral,
  sqliteRawHandle,
  type RawSqlHandle,
} from "../../content-types/engine/backup.js";
import { quoteIdent } from "../../content-types/naming.js";
import { ContentEngineError } from "../../content-types/engine/types.js";
import {
  FRESH_BOOT_DUMP,
  FRESH_BOOT_GITHUB_SYNC_COLUMNS,
  FRESH_BOOT_SUPER_ADMIN_ROLE_ID,
  FRESH_BOOT_SYSTEM_SETTINGS_COLUMNS,
} from "../../content-types/engine/fresh-boot-dump.generated.js";

function errorResponse(error: unknown): Response {
  if (error instanceof ContentEngineError) {
    return jsonResponse({ error: error.code, message: error.message }, error.code === "not_found" ? 404 : 500);
  }
  console.error("[drycms] full-reset route error", error);
  return jsonResponse({ error: "internal", message: "Internal server error." }, 500);
}

/** Mirrors `backup.ts`'s own binding lookup - this route talks to the raw
 * database directly (whole-table drop/recreate), not through a
 * `ContentEngineAdapter`, same reason `backup.ts` does. */
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

/**
 * `PUT {path}/api/full-reset/content` - the database half of "Reset
 * everything" (`GithubSyncSettings.tsx`'s Reset section, `status/full-reset.md`).
 * Wipes EVERY real table (every app-defined content type, and all 11 built-in
 * ones) and replaces them with a genuine fresh-boot schema+seed. Under the
 * local sqlite content engine, `sqlite.ts`'s `bootstrapDefaultContentSchema`
 * is run live against a throwaway IN-MEMORY database so the dump taken from
 * it (`engine/backup.ts`'s `buildSqlDump`) is byte-identical to what a
 * brand-new project actually boots with, rather than re-deriving the default
 * schema/seed some other way that could silently drift from it. Under D1 -
 * a Cloudflare Worker has no `bun:sqlite`/`node:sqlite`/`better-sqlite3` to
 * build that live, ever - the same dump is used precomputed instead:
 * `fresh-boot-dump.generated.ts`, produced by `scripts/build-fresh-boot-
 * dump.ts` (chained into `build:worker`) by running that exact same live
 * bootstrap under bun/node ahead of time, so it carries the same
 * no-drift guarantee without needing a request-time sqlite driver that
 * Workers simply doesn't have. Either dump is then replayed onto the REAL
 * database via `restoreFromDump` - the exact same primitive
 * `routes/backup.ts`'s restore already uses, so this inherits its atomicity/
 * D1-recovery guarantees for free.
 *
 * Three things kept, re-inserted verbatim after the fresh dump is restored:
 * the calling admin's own `user` row (same `id`, so the live session cookie -
 * which maps to this exact row - keeps working with no forced re-login)
 * except `avatar` (cleared; the file it pointed at is gone once the sibling
 * `media` reset wipes `storage`), plus a membership in the freshly-seeded
 * "Super Admin" role - the same "you become the first admin" outcome
 * `new:project`'s "register the first admin" step produces, minus having to
 * actually re-register; and the `githubSync`/`systemSettings` singleton rows
 * (Git repo/branch/token, admin theme) - operator configuration, not tenant
 * *content*, so "reset everything" leaves it alone same as it leaves the
 * calling admin's own account alone.
 */
async function resetContent(context: DryRouteContext): Promise<Response> {
  const denied = await requireSuperAdmin(context, "Only Super Admin can reset the database.");
  if (denied) return denied;
  const session = context.session;
  if (!session) return jsonResponse({ error: "unauthenticated", message: "Sign in required." }, 401);

  try {
    const rawHandle = await resolveRawHandle(context);

    const userRows = await rawHandle.queryAll("user");
    const preservedUser = userRows.find((row) => Number(row.id) === session.id);
    if (!preservedUser) {
      throw new ContentEngineError("not_found", "Your own user row could not be found - aborted before touching the database.");
    }
    const preservedGithubSync = await rawHandle.queryAll("githubSync");
    const preservedSystemSettings = await rawHandle.queryAll("systemSettings");

    let superAdminRoleId: number;
    let statements: string[];
    let githubSyncColumns: string[];
    let systemSettingsColumns: string[];
    if (content.engine === "D1") {
      // No bun:sqlite/node:sqlite/better-sqlite3 in a Worker - use the dump
      // precomputed at build time instead of building one live (see this
      // function's own doc comment).
      superAdminRoleId = FRESH_BOOT_SUPER_ADMIN_ROLE_ID;
      statements = parseSqlDump(FRESH_BOOT_DUMP);
      githubSyncColumns = FRESH_BOOT_GITHUB_SYNC_COLUMNS;
      systemSettingsColumns = FRESH_BOOT_SYSTEM_SETTINGS_COLUMNS;
    } else {
      const scratch = await resolveSqliteDriver(":memory:");
      bootstrapDefaultContentSchema(scratch);
      const roleId = scratch.all<{ id: number }>(`SELECT "id" FROM "role" WHERE "name" = 'Super Admin';`)[0]?.id;
      if (roleId === undefined) {
        throw new ContentEngineError("unsupported", "The fresh schema has no Super Admin role - aborted before touching the database.");
      }
      superAdminRoleId = roleId;
      statements = parseSqlDump(await buildSqlDump(sqliteRawHandle(scratch)));
      githubSyncColumns = scratch.all<{ name: string }>(`PRAGMA table_info("githubSync");`).map((row) => row.name);
      systemSettingsColumns = scratch.all<{ name: string }>(`PRAGMA table_info("systemSettings");`).map((row) => row.name);
    }

    // `_pages`/`_page_deps` (the page-build registry) live in this SAME
    // physical database, so `restoreFromDump` below drops them too - but
    // they're bootstrapped by `pages-registry-{sqlite,d1}.ts`'s OWN
    // `CREATE TABLE IF NOT EXISTS`, memoized once per live connection/
    // binding for the process/isolate's whole lifetime (same pattern
    // `sqlite.ts`'s `getHandle()` uses), so nothing re-runs that guard once
    // this request drops the tables out from under it. Recreated here
    // (empty - `github-sync.ts`'s PUT, the next step of "Reset everything",
    // is what actually repopulates/clears rows through the real adapter)
    // rather than left for that memoized bootstrap to eventually notice,
    // which it never will. Schema copied verbatim from
    // `pages-registry-sqlite.ts`/`pages-registry-d1.ts` - same
    // each-adapter-is-its-own-standalone-copy precedent `sqlite.ts` already
    // follows for `_versions`.
    statements.push(
      `CREATE TABLE IF NOT EXISTS "_pages" ("path" TEXT PRIMARY KEY, "object_key" TEXT NOT NULL, "build_id" TEXT NOT NULL, "built_at" INTEGER NOT NULL, "in_sitemap" INTEGER NOT NULL, "source_hash" TEXT);`,
      `CREATE TABLE IF NOT EXISTS "_page_deps" ("path" TEXT NOT NULL, "resource" TEXT NOT NULL, "version" INTEGER NOT NULL, PRIMARY KEY ("path", "resource"));`,
      `CREATE INDEX IF NOT EXISTS "ix_page_deps_resource" ON "_page_deps"("resource");`,
    );

    const userColumns = Object.keys(preservedUser);
    const userValues = userColumns.map((column) => (column === "avatar" ? "NULL" : sqlLiteral(preservedUser[column])));
    statements.push(
      `INSERT INTO "user" (${userColumns.map(quoteIdent).join(", ")}) VALUES (${userValues.join(", ")});`,
      `INSERT INTO "user_roles" ("parent_id","position","target_id") VALUES (${sqlLiteral(preservedUser.id)}, 0, ${sqlLiteral(superAdminRoleId)});`,
    );
    // Filtered against the FRESH table's own columns, not the live row's -
    // a live tenant's table can carry columns the current built-in default
    // definition no longer has (schema drift), and inserting those against
    // the just-recreated fresh table would fail with "has no column named
    // ...". Extra live-only values are simply dropped; every fresh column
    // this loop doesn't supply already has its own default/nullability from
    // the fresh `CREATE TABLE` itself.
    for (const [table, rows, freshColumns] of [
      ["githubSync", preservedGithubSync, githubSyncColumns],
      ["systemSettings", preservedSystemSettings, systemSettingsColumns],
    ] as const) {
      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => freshColumns.includes(column));
        const values = columns.map((column) => sqlLiteral(row[column]));
        statements.push(`INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${values.join(", ")});`);
      }
    }

    await restoreFromDump(rawHandle, statements);

    // The tables are only half of a fresh boot: the content types themselves
    // live in `content/types.json` (`schema-document.ts`), so the document
    // has to be replaced by the same freshly-seeded definitions the restored
    // tables were built from. Skipping this would leave a project whose
    // document still described the deleted app-defined types.
    let fresh = emptySchemaDocument();
    for (const definition of pendingSeed(new Set()).definitions) fresh = withAppliedType(fresh, definition);
    await createStorageSchemaDocumentStore(context).write(fresh);

    if (content.engine === "D1") await invalidateSchemaCache(context);

    return jsonResponse({ ok: true, keptUserId: preservedUser.id, keptGithubSync: preservedGithubSync.length > 0, keptSystemSettings: preservedSystemSettings.length > 0 });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * `PUT {path}/api/full-reset/media` - the media half of "Reset everything":
 * permanently deletes every object under the `storage` root (uploaded media,
 * including any entry-scoped/avatar folders - `dry-icons/` is a SEPARATE
 * storage root, per `icons.config.json`, and is untouched). Same "remove
 * each root entry recursively" shape `github-sync.ts`'s PUT already uses for
 * `pagesSourceStorage`, applied here to the media root instead.
 */
async function resetMedia(context: DryRouteContext): Promise<Response> {
  const denied = await requireSuperAdmin(context, "Only Super Admin can reset media storage.");
  if (denied) return denied;
  try {
    const adapter = getStorageAdapter(storage, context);
    let removed = 0;
    for (const entry of await adapter.list("", true)) {
      await adapter.remove(entry.path);
      removed += 1;
    }
    return jsonResponse({ ok: true, removed });
  } catch (error) {
    return errorResponse(error);
  }
}

/** `content`/`media` sub-operations dispatch by slug (`?` matches
 * `content-history.ts`'s own precedent for a segment with more than one
 * mutating operation) - `GithubSyncSettings.tsx`'s reset flow calls both in
 * sequence, one `fetch` each, so its progress dialog can show them as two
 * distinct steps. */
export const PUT: DryRouteHandler = async (context) => {
  const slug = context.params.slug ?? "";
  if (slug === "content") return resetContent(context);
  if (slug === "media") return resetMedia(context);
  return jsonResponse({ error: "not_found", message: "Unknown full-reset operation." }, 404);
};
