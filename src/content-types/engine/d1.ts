import type { ResolvedD1ContentOption } from "../../server/options.js";
import { planDelete, planSave as planSaveEngine, type SavePlan } from "../migration.js";
import { pendingSeedStatements } from "../seed.js";
import { superAdminSeedStatement } from "../permissions.js";
import { findDependents } from "../tree.js";
import type { ContentTypeDefinition } from "../types.js";
import { prepare, runBatch, type D1Database } from "./d1-driver.js";
import { ContentEngineError, type ContentEngineAdapter } from "./types.js";

/**
 * Looks up the live `D1Database` for `option.binding` on `runtimeEnv`
 * (`context.locals.runtime.env` under `@astrojs/cloudflare` - drycms itself
 * doesn't depend on that adapter, the caller is expected to pass the right
 * object through). Unlike the sqlite engine, this can't be resolved once at
 * module scope: the binding only exists per-request.
 */
/**
 * Keyed by the live binding rather than held in the adapter's own closure:
 * `content-adapters.ts` builds a NEW adapter per request (a D1 binding is
 * only resolvable per-request), so a per-adapter memo made `ensureBootstrap`
 * re-run its DDL + seed check on every single request - 6 wasted D1 round
 * trips per page view (see `status/worker-request-cost.md`). The binding
 * object itself is stable for the isolate, so this memoizes for exactly as
 * long as it's safe to. A rejected bootstrap is evicted so the next request
 * retries instead of inheriting a permanently failed promise.
 */
const bootstrapByBinding = new WeakMap<D1Database, Promise<void>>();

export function createD1ContentEngineAdapter(
  option: ResolvedD1ContentOption,
  runtimeEnv: Record<string, unknown> | undefined,
): ContentEngineAdapter {
  const maybeDb = runtimeEnv?.[option.binding] as D1Database | undefined;
  if (!maybeDb) {
    throw new ContentEngineError(
      "unsupported",
      `[drycms] D1 binding "${option.binding}" was not found on the request env - check wrangler.jsonc's d1_databases config.`,
    );
  }
  // Narrowed once, to a variable the closures below capture - `db` itself
  // stays possibly-undefined to TS across an arrow-function boundary even
  // though the throw above guarantees it's set by the time any of them run.
  const db: D1Database = maybeDb;

  // The whole content-types collection is one resource for versioning
  // purposes (see `status/build-cache.md`) - `"__content-types__"` can never
  // collide with a real content type name (`naming.ts`'s
  // `CONTENT_TYPE_NAME_RE` forbids a leading underscore). Same `_versions`
  // shape as `entries-d1.ts`'s per-resource data version; kept as its own
  // copy rather than a shared import, same precedent as everywhere else in
  // this file.
  const CONTENT_TYPES_RESOURCE = "__content-types__";

  async function getResourceVersionValue(resource: string): Promise<number> {
    const rows = await db.prepare('SELECT "version" FROM "_versions" WHERE "resource" = ?;').bind(resource).all<{ version: number }>();
    return rows.results?.[0]?.version ?? 0;
  }

  /** Same "not a real transaction, just sequenced after the data write"
   * caveat as `entries-d1.ts`'s `bumpResourceVersion` - see that file's doc
   * comment. */
  async function bumpResourceVersion(resource: string): Promise<void> {
    const next = (await getResourceVersionValue(resource)) + 1;
    await db
      .prepare(
        'INSERT INTO "_versions" ("resource","version","updated_at") VALUES (?,?,?) ' +
          'ON CONFLICT("resource") DO UPDATE SET "version" = excluded."version", "updated_at" = excluded."updated_at";',
      )
      .bind(resource, next, Date.now())
      .run();
  }

  async function ensureBootstrap(): Promise<void> {
    let bootstrapped = bootstrapByBinding.get(db);
    if (!bootstrapped) {
      bootstrapped = (async () => {
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS "metadata" (\n` +
              `  "id" TEXT PRIMARY KEY,\n` +
              `  "kind" TEXT NOT NULL,\n` +
              `  "name" TEXT NOT NULL,\n` +
              `  "definition" TEXT NOT NULL,\n` +
              `  "version" INTEGER NOT NULL\n` +
              `);`,
          )
          .run();
        await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_metadata_name" ON "metadata"("name" COLLATE NOCASE);`).run();
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS "_versions" (\n` +
              `  "resource" TEXT PRIMARY KEY,\n` +
              `  "version" INTEGER NOT NULL,\n` +
              `  "updated_at" INTEGER NOT NULL\n` +
              `);`,
          )
          .run();

        const existing = await db.prepare('SELECT "name" FROM "metadata";').all<{ name: string }>();
        const statements = pendingSeedStatements(new Set((existing.results ?? []).map((row) => row.name.toLowerCase())));
        await runBatch(db, statements);
        if (statements.length > 0) await bumpResourceVersion(CONTENT_TYPES_RESOURCE);

        const superAdmin = superAdminSeedStatement();
        await db.prepare(superAdmin.sql).bind(...(superAdmin.params ?? [])).run();

      })();
      bootstrapByBinding.set(db, bootstrapped);
      bootstrapped.catch(() => bootstrapByBinding.delete(db));
    }
    return bootstrapped;
  }

  async function listContentTypes(): Promise<ContentTypeDefinition[]> {
    await ensureBootstrap();
    const result = await db.prepare('SELECT "definition" FROM "metadata";').all<{ definition: string }>();
    return (result.results ?? []).map((row) => JSON.parse(row.definition) as ContentTypeDefinition);
  }

  async function getContentType(id: string): Promise<ContentTypeDefinition | null> {
    await ensureBootstrap();
    const result = await db
      .prepare('SELECT "definition" FROM "metadata" WHERE "id" = ?;')
      .bind(id)
      .all<{ definition: string }>();
    const row = result.results?.[0];
    return row ? (JSON.parse(row.definition) as ContentTypeDefinition) : null;
  }

  async function planSave(next: ContentTypeDefinition): Promise<SavePlan> {
    const oldAllTypes = await listContentTypes();
    // See the sqlite adapter's identical check: `planMigration` derives
    // `expectedVersion` from whatever's CURRENTLY in `oldAllTypes`, so it
    // can never by itself catch a stale client edit - that has to be
    // checked explicitly, against the version the caller actually submitted.
    const current = oldAllTypes.find((t) => t.id === next.id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== next.version) {
      throw new ContentEngineError(
        "version_conflict",
        `Content type "${next.id}" changed since it was loaded (expected v${next.version}, found v${currentVersion}).`,
      );
    }
    const newAllTypes = [...oldAllTypes.filter((t) => t.id !== next.id), next];
    return planSaveEngine({ savedType: next, oldAllTypes, newAllTypes });
  }

  async function applySave(next: ContentTypeDefinition, plan: SavePlan): Promise<ContentTypeDefinition> {
    await ensureBootstrap();
    const allPlans = [plan.primary, ...plan.cascaded];

    for (const p of allPlans) {
      const current = await getContentType(p.targetContentTypeId);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== p.expectedVersion) {
        throw new ContentEngineError(
          "version_conflict",
          `Content type "${p.targetContentTypeId}" changed since this plan was computed (expected v${p.expectedVersion}, found v${currentVersion}).`,
        );
      }
    }

    // D1 has no cross-statement transaction the way local SQLite does -
    // `.batch()` is atomic per call. Batching per TABLE (not one call for
    // the whole plan) keeps each table's own migration atomic; a SavePlan
    // spanning multiple tables (a component cascade, or several child
    // tables) is therefore atomic per-table, NOT atomic as a whole, unlike
    // local SQLite's single transaction - a real platform difference.
    // Metadata version-bumps run last, only after every table batch
    // succeeds, so `metadata` never claims a version whose table rebuild
    // didn't fully complete.
    for (const p of allPlans) {
      for (const table of p.tables) {
        await runBatch(db, table.statements);
      }
    }
    for (const p of allPlans) {
      const result = await prepare(db, p.metadataStatement).run();
      if ((result.meta.changes ?? 0) === 0) {
        throw new ContentEngineError(
          "version_conflict",
          `Metadata write for "${p.targetContentTypeId}" was rejected (version conflict).`,
        );
      }
    }
    await bumpResourceVersion(CONTENT_TYPES_RESOURCE);

    const saved = await getContentType(next.id);
    if (!saved) throw new ContentEngineError("not_found", `Content type "${next.id}" not found after save.`);
    return saved;
  }

  async function deleteContentType(id: string): Promise<void> {
    await ensureBootstrap();
    const existing = await getContentType(id);
    if (!existing) throw new ContentEngineError("not_found", `Content type "${id}" not found.`);

    const allTypes = await listContentTypes();
    if (existing.kind === "component") {
      const dependents = findDependents(id, allTypes);
      if (dependents.length > 0) {
        throw new ContentEngineError(
          "in_use",
          `Component "${existing.name}" is still used by: ${dependents.map((d) => d.name).join(", ")}.`,
        );
      }
    }

    const dropStatements = planDelete(existing, allTypes);
    await runBatch(db, dropStatements);
    await db.prepare('DELETE FROM "metadata" WHERE "id" = ?;').bind(id).run();
    await bumpResourceVersion(CONTENT_TYPES_RESOURCE);
  }

  return {
    listContentTypes,
    getContentType,
    planSave,
    applySave,
    deleteContentType,
    getResourceVersion: async () => {
      await ensureBootstrap();
      return getResourceVersionValue(CONTENT_TYPES_RESOURCE);
    },
  };
}
