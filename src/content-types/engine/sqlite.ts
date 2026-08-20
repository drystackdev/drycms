import type { ResolvedSqliteContentOption } from "../../server/options.js";
import { planDelete, planSave as planSaveEngine, type SavePlan, type Statement } from "../migration.js";
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
import { resolveSqliteDriver, type SqliteHandle } from "./sqlite-driver.js";
import { ContentEngineError, type ContentEngineAdapter, type SaveBatchContext } from "./types.js";

function runStatements(handle: SqliteHandle, statements: Statement[]): void {
  for (const stmt of statements) handle.run(stmt.sql, stmt.params ?? []);
}

/** The whole content-types collection is one resource for versioning
 * purposes - `"__content-types__"` can never collide with a real content
 * type name (`naming.ts`'s `CONTENT_TYPE_NAME_RE` forbids underscores).
 * Same `_versions` table shape/SQL as `entries-sqlite.ts`'s per-resource
 * data version. Kept in sync with `content/types.json`'s own `revision` (the
 * value `getResourceVersion()` actually returns) so anything still reading
 * the table - a restored backup, an older tenant - sees a moving counter
 * rather than a frozen one. */
const CONTENT_TYPES_RESOURCE = "__content-types__";

function getResourceVersion(handle: SqliteHandle, resource: string): number {
  const rows = handle.all<{ version: number }>('SELECT "version" FROM "_versions" WHERE "resource" = ?;', [resource]);
  return rows[0]?.version ?? 0;
}

function setResourceVersion(handle: SqliteHandle, resource: string, version: number): void {
  handle.run(
    'INSERT INTO "_versions" ("resource","version","updated_at") VALUES (?,?,?) ' +
      'ON CONFLICT("resource") DO UPDATE SET "version" = excluded."version", "updated_at" = excluded."updated_at";',
    [resource, version, Date.now()],
  );
}

/**
 * The definitions of a project created BEFORE content types moved into
 * `content/types.json` (`status/content-types-json-file.md`), read straight
 * out of the old `metadata` table so they can be imported into the document
 * once. `[]` when the table was never created (a fresh project) or is empty.
 *
 * Read-only, and only ever consulted when the document file is missing - a
 * project whose document exists never looks at the table again, and nothing
 * writes to it any more.
 */
function readLegacyMetadata(handle: SqliteHandle): ContentTypeDefinition[] {
  const tables = handle.all<{ name: string }>(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'metadata';`);
  if (tables.length === 0) return [];
  const rows = handle.all<{ definition: string }>('SELECT "definition" FROM "metadata";');
  const definitions: ContentTypeDefinition[] = [];
  for (const row of rows) {
    try {
      definitions.push(JSON.parse(row.definition) as ContentTypeDefinition);
    } catch {
      // One unreadable row must not cost the project every other type - the
      // import is best-effort by design, and the admin can re-create a single
      // broken type by hand far more easily than a whole schema.
    }
  }
  return definitions;
}

/**
 * Creates `_versions` (if missing), runs the table DDL + row seeds for
 * whichever default content types aren't present yet (`seed.ts`'s
 * `pendingSeed`, idempotent by name), and seeds the permanent Super Admin
 * role - exactly what a brand-new `.dry/content.sqlite` gets on its very
 * first `getHandle()` call below. Returns the DEFINITIONS it seeded, for the
 * caller to write into `content/types.json` (this function deliberately does
 * no document I/O of its own: `routes/full-reset.ts` runs it against a
 * throwaway in-memory handle purely to dump the fresh-boot SQL).
 */
export function bootstrapDefaultContentSchema(
  handle: SqliteHandle,
  existingNamesLowercase: ReadonlySet<string> = new Set(),
): ContentTypeDefinition[] {
  handle.exec(
    `CREATE TABLE IF NOT EXISTS "_versions" (\n` +
      `  "resource" TEXT PRIMARY KEY,\n` +
      `  "version" INTEGER NOT NULL,\n` +
      `  "updated_at" INTEGER NOT NULL\n` +
      `);`,
  );

  const { statements, definitions } = pendingSeed(existingNamesLowercase);
  if (statements.length > 0) {
    handle.exec("BEGIN IMMEDIATE;");
    try {
      runStatements(handle, statements);
      handle.exec("COMMIT;");
    } catch (error) {
      handle.exec("ROLLBACK;");
      throw error;
    }
  }

  handle.run(superAdminSeedStatement().sql, superAdminSeedStatement().params ?? []);
  return definitions;
}

export function createSqliteContentEngineAdapter(
  option: ResolvedSqliteContentOption,
  documentStore: SchemaDocumentStore = createMemorySchemaDocumentStore(),
): ContentEngineAdapter {
  let handlePromise: Promise<SqliteHandle> | undefined;
  let bootstrapped = false;

  async function getHandle(): Promise<SqliteHandle> {
    handlePromise ??= resolveSqliteDriver(option.file);
    return handlePromise;
  }

  /**
   * The document, with the default content types guaranteed present. Runs
   * the seed at most once per adapter instance (the adapter itself is
   * module-cached for the whole process under sqlite), then re-reads the
   * document on every call so an edit made outside this process - a `git
   * pull`, the Page Builder writing the file, a second dev tool - is picked
   * up rather than served from a stale in-memory copy.
   */
  async function loadDocument(): Promise<SchemaDocument> {
    const handle = await getHandle();
    const stored = await documentStore.read();
    if (bootstrapped && stored) return stored;

    // No document yet: either a brand-new project, or one created before the
    // schema moved out of `metadata` - import that table's rows once.
    let doc = stored ?? { ...emptySchemaDocument(), applied: readLegacyMetadata(handle) };
    const seeded = bootstrapDefaultContentSchema(handle, new Set(doc.applied.map((type) => type.name.toLowerCase())));
    if (seeded.length > 0 || !stored) {
      for (const definition of seeded) doc = withAppliedType(doc, definition);
      await documentStore.write(doc);
      setResourceVersion(handle, CONTENT_TYPES_RESOURCE, doc.revision);
    }
    bootstrapped = true;
    return doc;
  }

  /** Writes the document first, then mirrors its `revision` into `_versions`
   * - the table is a convenience copy, never the value anything reads back
   * (`getResourceVersion` below reads the document), so a failure to update
   * it can't desynchronize anything. */
  async function saveDocument(doc: SchemaDocument): Promise<void> {
    await documentStore.write(doc);
    setResourceVersion(await getHandle(), CONTENT_TYPES_RESOURCE, doc.revision);
  }

  async function listContentTypes(): Promise<ContentTypeDefinition[]> {
    return (await loadDocument()).applied;
  }

  async function getContentType(id: string): Promise<ContentTypeDefinition | null> {
    return (await listContentTypes()).find((type) => type.id === id) ?? null;
  }

  async function planSave(next: ContentTypeDefinition, batch: SaveBatchContext = {}): Promise<SavePlan> {
    const oldAllTypes = await listContentTypes();
    // `planMigration` derives `expectedVersion` from whatever's CURRENTLY in
    // `oldAllTypes`, which is always fresh at this point - so it can never
    // by itself catch a stale client edit (the caller's `next.version`
    // predating a save someone else already made). That has to be checked
    // explicitly, against the version the caller actually submitted.
    const current = oldAllTypes.find((t) => t.id === next.id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== next.version) {
      throw new ContentEngineError(
        "version_conflict",
        `Content type "${next.id}" changed since it was loaded (expected v${next.version}, found v${currentVersion}).`,
      );
    }
    // The NEW-state universe every component reference resolves against:
    // what's live, with `next` (and any sibling draft from the same batch)
    // layered over it. `oldAllTypes` deliberately stays pure-live - it's the
    // diff baseline, so a not-yet-applied draft must never appear there.
    const overlay = [...(batch.pendingTypes ?? []).filter((t) => t.id !== next.id), next];
    const newAllTypes = [...oldAllTypes.filter((t) => !overlay.some((o) => o.id === t.id)), ...overlay];
    return planSaveEngine({ savedType: next, oldAllTypes, newAllTypes });
  }

  async function applySave(next: ContentTypeDefinition, plan: SavePlan): Promise<ContentTypeDefinition> {
    const handle = await getHandle();
    const allPlans = [plan.primary, ...plan.cascaded];
    let doc = await loadDocument();

    // A stale plan (a concurrent edit landed between planSave() and this
    // call) must never be replayed against a schema it no longer matches -
    // re-verify every affected content type is still at the version the
    // plan was computed against, before running a single statement.
    for (const p of allPlans) {
      const currentVersion = doc.applied.find((type) => type.id === p.targetContentTypeId)?.version ?? 0;
      if (currentVersion !== p.expectedVersion) {
        throw new ContentEngineError(
          "version_conflict",
          `Content type "${p.targetContentTypeId}" changed since this plan was computed (expected v${p.expectedVersion}, found v${currentVersion}).`,
        );
      }
    }

    // Standard prep for SQLite's 12-step table-recreate procedure - a no-op
    // today since no generated DDL declares real `FOREIGN KEY` constraints,
    // but required once `parent_id`/`target_id` columns gain them.
    const needsForeignKeysOff = allPlans.some((p) => p.tables.some((t) => t.action === "recreate"));
    if (needsForeignKeysOff) handle.exec("PRAGMA foreign_keys = OFF;");
    try {
      handle.exec("BEGIN IMMEDIATE;");
      try {
        for (const p of allPlans) {
          for (const table of p.tables) runStatements(handle, table.statements);
        }
        handle.exec("COMMIT;");
      } catch (error) {
        handle.exec("ROLLBACK;");
        throw error;
      }
    } finally {
      if (needsForeignKeysOff) handle.exec("PRAGMA foreign_keys = ON;");
    }

    // Tables first, document second: the tables are the half that cannot be
    // rolled back once committed, so the document is only advanced to a
    // schema the database provably already has. A failure here leaves the
    // document one apply behind - re-running the same apply is safe (the
    // table statements are idempotent-by-diff, and the plan is re-computed
    // from the document) - so it is reported, not swallowed.
    for (const p of allPlans) doc = withAppliedType(doc, p.nextDefinition);
    await saveDocument(doc);

    const saved = doc.applied.find((type) => type.id === next.id);
    if (!saved) throw new ContentEngineError("not_found", `Content type "${next.id}" not found after save.`);
    return saved;
  }

  async function deleteContentType(id: string): Promise<void> {
    const handle = await getHandle();
    const doc = await loadDocument();
    const existing = doc.applied.find((type) => type.id === id) ?? null;
    if (!existing) throw new ContentEngineError("not_found", `Content type "${id}" not found.`);

    if (existing.kind === "component") {
      const dependents = findDependents(id, doc.applied);
      if (dependents.length > 0) {
        throw new ContentEngineError(
          "in_use",
          `Component "${existing.name}" is still used by: ${dependents.map((d) => d.name).join(", ")}.`,
        );
      }
    }

    const dropStatements = planDelete(existing, doc.applied);
    handle.exec("BEGIN IMMEDIATE;");
    try {
      runStatements(handle, dropStatements);
      handle.exec("COMMIT;");
    } catch (error) {
      handle.exec("ROLLBACK;");
      throw error;
    }
    await saveDocument(withoutAppliedType(doc, id));
  }

  return {
    listContentTypes,
    getContentType,
    planSave,
    applySave,
    deleteContentType,
    getResourceVersion: async () => (await loadDocument()).revision,
  };
}
