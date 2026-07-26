import type { ResolvedD1ContentOption } from "../../integration/options.js";
import { planDelete, planSave as planSaveEngine, type SavePlan, type Statement } from "../migration.js";
import { findDependents } from "../tree.js";
import type { ContentTypeDefinition } from "../types.js";
import { ContentEngineError, type ContentEngineAdapter } from "./types.js";

/**
 * A minimal, hand-rolled subset of Cloudflare's `D1Database` API - the same
 * precedent `storage/github.ts` sets for a small Cloudflare-specific shape
 * (there, `CloudflareRequestInit`) rather than depending on
 * `@cloudflare/workers-types` just for one interface. Structurally
 * compatible with the real binding; consumers pass the genuine object at
 * runtime, this is only a type.
 */
export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; [key: string]: unknown };
}
export interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

function prepare(db: D1Database, statement: Statement): D1PreparedStatement {
  return db.prepare(statement.sql).bind(...(statement.params ?? []));
}

async function runBatch(db: D1Database, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements.map((s) => prepare(db, s)));
}

/**
 * Looks up the live `D1Database` for `option.binding` on `runtimeEnv`
 * (`context.locals.runtime.env` under `@astrojs/cloudflare` - drycms itself
 * doesn't depend on that adapter, the caller is expected to pass the right
 * object through). Unlike the sqlite engine, this can't be resolved once at
 * module scope: the binding only exists per-request.
 */
export function createD1ContentEngineAdapter(
  option: ResolvedD1ContentOption,
  runtimeEnv: Record<string, unknown> | undefined,
): ContentEngineAdapter {
  const maybeDb = runtimeEnv?.[option.binding] as D1Database | undefined;
  if (!maybeDb) {
    throw new ContentEngineError(
      "unsupported",
      `[drycms] D1 binding "${option.binding}" was not found on context.locals.runtime.env - check wrangler.jsonc's d1_databases config.`,
    );
  }
  // Narrowed once, to a variable the closures below capture - `db` itself
  // stays possibly-undefined to TS across an arrow-function boundary even
  // though the throw above guarantees it's set by the time any of them run.
  const db: D1Database = maybeDb;

  let bootstrapped: Promise<void> | undefined;
  async function ensureBootstrap(): Promise<void> {
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
      })();
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
  }

  return { listContentTypes, getContentType, planSave, applySave, deleteContentType };
}
