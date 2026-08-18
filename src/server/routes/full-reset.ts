import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { content, storage } from "../config.js";
import { requireSuperAdmin } from "../admin-access.js";
import { jsonResponse } from "../route-helpers.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { invalidateSchemaCache } from "../content-adapters.js";
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
 * ones) and replaces them with a genuine fresh-boot schema+seed:
 * `sqlite.ts`'s `bootstrapDefaultContentSchema` is run against a throwaway
 * IN-MEMORY database so the dump taken from it (`engine/backup.ts`'s
 * `buildSqlDump`) is byte-identical to what a brand-new project actually
 * boots with, rather than re-deriving the default schema/seed some other way
 * that could silently drift from it. That dump is then replayed onto the
 * REAL database via `restoreFromDump` - the exact same primitive
 * `routes/backup.ts`'s restore already uses, so this inherits its atomicity/
 * D1-recovery guarantees for free.
 *
 * The ONE thing kept: the calling admin's own `user` row, re-inserted
 * verbatim (same `id`, so the live session cookie - which maps to this exact
 * row - keeps working with no forced re-login) except `avatar` (cleared; the
 * file it pointed at is gone once the sibling `media` reset wipes `storage`),
 * plus a membership in the freshly-seeded "Super Admin" role - the same "you
 * become the first admin" outcome `new:project`'s "register the first admin"
 * step produces, minus having to actually re-register.
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

    const scratch = await resolveSqliteDriver(":memory:");
    bootstrapDefaultContentSchema(scratch);
    const superAdminRoleId = scratch.all<{ id: number }>(`SELECT "id" FROM "role" WHERE "name" = 'Super Admin';`)[0]?.id;
    if (superAdminRoleId === undefined) {
      throw new ContentEngineError("unsupported", "The fresh schema has no Super Admin role - aborted before touching the database.");
    }
    const statements = parseSqlDump(await buildSqlDump(sqliteRawHandle(scratch)));

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

    await restoreFromDump(rawHandle, statements);
    if (content.engine === "D1") await invalidateSchemaCache(context);

    return jsonResponse({ ok: true, keptUserId: preservedUser.id });
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
