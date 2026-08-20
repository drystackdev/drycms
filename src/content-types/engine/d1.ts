import type { ResolvedD1ContentOption } from "../../server/options.js";
import { planDelete, planSave as planSaveEngine, type SavePlan } from "../migration.js";
import { pendingSeed } from "../seed.js";
import { superAdminSeedStatement } from "../permissions.js";
import { findDependents } from "../tree.js";
import type { ContentTypeDefinition } from "../types.js";
import {
  emptySchemaDocument,
  withAppliedType,
  withoutAppliedType,
  type SchemaDocument,
} from "../schema-document.js";
import { createMemorySchemaDocumentStore, type SchemaDocumentStore } from "./schema-document-store.js";
import { runBatch, type D1Database } from "./d1-driver.js";
import { ContentEngineError, type ContentEngineAdapter, type SaveBatchContext } from "./types.js";

/**
 * Looks up the live `D1Database` for `option.binding` on `runtimeEnv` (the
 * Workers `env` object, passed through by the caller). Unlike the sqlite
 * engine, this can't be resolved once at module scope: the binding only
 * exists per-request.
 */
/**
 * Keyed by the live binding rather than held in the adapter's own closure:
 * `content-adapters.ts` builds a NEW adapter per request (a D1 binding is
 * only resolvable per-request), so a per-adapter memo made `ensureBootstrap`
 * re-run its DDL + seed check on every single request - 6 wasted D1 round
 * trips per page view (see `status/worker-request-cost.md`). The binding
 * object itself is stable for the isolate, so this memoizes for exactly as
 * long as it's safe to.
 *
 * A set of FINISHED bootstraps, never the in-flight promise: sharing a
 * promise across requests hangs the whole isolate the moment the request
 * that created it is canceled - see `entries-d1.ts`'s `versionsTableReady`
 * for the full write-up (that exact pattern, in that file, is what took
 * production down). Racing requests before the first success just re-run an
 * idempotent bootstrap.
 */
const bootstrappedBindings = new WeakSet<D1Database>();

export function createD1ContentEngineAdapter(
  option: ResolvedD1ContentOption,
  runtimeEnv: Record<string, unknown> | undefined,
  documentStore: SchemaDocumentStore = createMemorySchemaDocumentStore(),
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

  /**
   * Memoized for the LIFE OF THIS ADAPTER INSTANCE only - `content-adapters.ts`
   * builds a fresh D1 adapter per request (`requestAdapters`, keyed by the
   * request's own `context` object), so this never survives past the request
   * that populated it. `listContentTypes()` used to be the single most-called
   * D1 query in the app: every route calls it independently (each
   * `admin-access.ts` gate, most `routes/*.ts` handlers), often 3-4 times in
   * one request, for data that can't have changed mid-request except through
   * `applySave`/`deleteContentType` below - both of which reset this to
   * force a fresh read. Storing the PROMISE (not just the resolved array)
   * collapses concurrent callers in the same request onto one D1 round trip
   * too, not just sequential ones.
   */
  let cachedListPromise: Promise<ContentTypeDefinition[]> | null = null;

  /** Mirrors the document's `revision` into `_versions` for anything still
   * reading that table. Same "not a real transaction, just sequenced after
   * the data write" caveat as `entries-d1.ts`'s `bumpResourceVersion`. */
  async function setResourceVersion(resource: string, next: number): Promise<void> {
    await db
      .prepare(
        'INSERT INTO "_versions" ("resource","version","updated_at") VALUES (?,?,?) ' +
          'ON CONFLICT("resource") DO UPDATE SET "version" = excluded."version", "updated_at" = excluded."updated_at";',
      )
      .bind(resource, next, Date.now())
      .run();
  }

  /**
   * Definitions from the pre-JSON `metadata` table (`status/content-types-
   * json-file.md`), read once when `content/types.json` doesn't exist yet so
   * a project created before the move keeps its schema. `[]` when the table
   * was never created. Nothing writes to that table any more.
   */
  async function readLegacyMetadata(): Promise<ContentTypeDefinition[]> {
    const tables = await db
      .prepare(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'metadata';`)
      .all<{ name: string }>();
    if ((tables.results ?? []).length === 0) return [];
    const rows = await db.prepare('SELECT "definition" FROM "metadata";').all<{ definition: string }>();
    const definitions: ContentTypeDefinition[] = [];
    for (const row of rows.results ?? []) {
      try {
        definitions.push(JSON.parse(row.definition) as ContentTypeDefinition);
      } catch {
        // Best-effort, same as the sqlite adapter's copy: one unreadable row
        // must not cost the project every other type.
      }
    }
    return definitions;
  }

  async function ensureBootstrap(): Promise<SchemaDocument> {
    const stored = await documentStore.read();
    if (bootstrappedBindings.has(db) && stored) return stored;

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "_versions" (\n` +
          `  "resource" TEXT PRIMARY KEY,\n` +
          `  "version" INTEGER NOT NULL,\n` +
          `  "updated_at" INTEGER NOT NULL\n` +
          `);`,
      )
      .run();

    let doc = stored ?? { ...emptySchemaDocument(), applied: await readLegacyMetadata() };
    const { statements, definitions } = pendingSeed(new Set(doc.applied.map((type) => type.name.toLowerCase())));
    await runBatch(db, statements);
    if (definitions.length > 0 || !stored) {
      for (const definition of definitions) doc = withAppliedType(doc, definition);
      await saveDocument(doc);
    }

    const superAdmin = superAdminSeedStatement();
    await db.prepare(superAdmin.sql).bind(...(superAdmin.params ?? [])).run();

    bootstrappedBindings.add(db);
    cachedListPromise = null;
    return doc;
  }

  /** Document first, `_versions` second - the table is a mirror kept for
   * anything still reading it, never the value `getResourceVersion()`
   * returns (that comes from the document's own `revision`). */
  async function saveDocument(doc: SchemaDocument): Promise<void> {
    await documentStore.write(doc);
    cachedListPromise = null;
    await setResourceVersion(CONTENT_TYPES_RESOURCE, doc.revision);
  }

  async function listContentTypes(): Promise<ContentTypeDefinition[]> {
    cachedListPromise ??= ensureBootstrap().then((doc) => doc.applied);
    return cachedListPromise;
  }

  async function getContentType(id: string): Promise<ContentTypeDefinition | null> {
    return (await listContentTypes()).find((type) => type.id === id) ?? null;
  }

  async function planSave(next: ContentTypeDefinition, batch: SaveBatchContext = {}): Promise<SavePlan> {
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
    // Same overlay the sqlite adapter builds - see its comment: `newAllTypes`
    // is the resolution universe (live + this batch's other drafts),
    // `oldAllTypes` stays pure-live because it's the diff baseline.
    const overlay = [...(batch.pendingTypes ?? []).filter((t) => t.id !== next.id), next];
    const newAllTypes = [...oldAllTypes.filter((t) => !overlay.some((o) => o.id === t.id)), ...overlay];
    return planSaveEngine({ savedType: next, oldAllTypes, newAllTypes });
  }

  async function applySave(next: ContentTypeDefinition, plan: SavePlan): Promise<ContentTypeDefinition> {
    let doc = await ensureBootstrap();
    const allPlans = [plan.primary, ...plan.cascaded];

    for (const p of allPlans) {
      const currentVersion = doc.applied.find((type) => type.id === p.targetContentTypeId)?.version ?? 0;
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
    // The document write runs last, only after every table batch succeeds,
    // so `content/types.json` never claims a schema whose table rebuild
    // didn't fully complete.
    for (const p of allPlans) {
      for (const table of p.tables) {
        await runBatch(db, table.statements);
      }
    }
    for (const p of allPlans) doc = withAppliedType(doc, p.nextDefinition);
    await saveDocument(doc);

    const saved = doc.applied.find((type) => type.id === next.id);
    if (!saved) throw new ContentEngineError("not_found", `Content type "${next.id}" not found after save.`);
    return saved;
  }

  async function deleteContentType(id: string): Promise<void> {
    const doc = await ensureBootstrap();
    const existing = doc.applied.find((type) => type.id === id) ?? null;
    if (!existing) throw new ContentEngineError("not_found", `Content type "${id}" not found.`);

    const allTypes = doc.applied;
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
    await saveDocument(withoutAppliedType(doc, id));
  }

  return {
    listContentTypes,
    getContentType,
    planSave,
    applySave,
    deleteContentType,
    getResourceVersion: async () => (await ensureBootstrap()).revision,
  };
}
