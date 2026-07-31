import type { ResolvedSqliteContentOption } from "../../server/options.js";
import { planDelete, planSave as planSaveEngine, type SavePlan, type Statement } from "../migration.js";
import {
  permissionDeleteStatements,
  permissionSyncStatements,
  permissionUniqueIndexStatement,
  superAdminSeedStatement,
} from "../permissions.js";
import { pendingSeedStatements } from "../seed.js";
import { findDependents } from "../tree.js";
import type { ContentTypeDefinition } from "../types.js";
import { resolveSqliteDriver, type SqliteHandle } from "./sqlite-driver.js";
import { ContentEngineError, type ContentEngineAdapter } from "./types.js";

function runStatements(handle: SqliteHandle, statements: Statement[]): void {
  for (const stmt of statements) handle.run(stmt.sql, stmt.params ?? []);
}

/** The whole content-types collection is one resource for versioning
 * purposes - `"__content-types__"` can never collide with a real content
 * type name (`naming.ts`'s `CONTENT_TYPE_NAME_RE` forbids underscores).
 * Same `_versions` table shape/SQL as `entries-sqlite.ts`'s per-resource
 * data version - kept as its own copy here rather than a shared import,
 * matching this codebase's existing precedent of each engine adapter being
 * a full standalone implementation (see `entries-d1.ts`'s doc comment). */
const CONTENT_TYPES_RESOURCE = "__content-types__";

function getResourceVersion(handle: SqliteHandle, resource: string): number {
  const rows = handle.all<{ version: number }>('SELECT "version" FROM "_versions" WHERE "resource" = ?;', [resource]);
  return rows[0]?.version ?? 0;
}

function bumpResourceVersion(handle: SqliteHandle, resource: string): number {
  const next = getResourceVersion(handle, resource) + 1;
  handle.run(
    'INSERT INTO "_versions" ("resource","version","updated_at") VALUES (?,?,?) ' +
      'ON CONFLICT("resource") DO UPDATE SET "version" = excluded."version", "updated_at" = excluded."updated_at";',
    [resource, next, Date.now()],
  );
  return next;
}

export function createSqliteContentEngineAdapter(option: ResolvedSqliteContentOption): ContentEngineAdapter {
  let handlePromise: Promise<SqliteHandle> | undefined;

  async function getHandle(): Promise<SqliteHandle> {
    if (!handlePromise) {
      handlePromise = resolveSqliteDriver(option.file).then((handle) => {
        handle.exec(
          `CREATE TABLE IF NOT EXISTS "metadata" (\n` +
            `  "id" TEXT PRIMARY KEY,\n` +
            `  "kind" TEXT NOT NULL,\n` +
            `  "name" TEXT NOT NULL,\n` +
            `  "definition" TEXT NOT NULL,\n` +
            `  "version" INTEGER NOT NULL\n` +
            `);`,
        );
        handle.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_metadata_name" ON "metadata"("name" COLLATE NOCASE);`);
        handle.exec(
          `CREATE TABLE IF NOT EXISTS "_versions" (\n` +
            `  "resource" TEXT PRIMARY KEY,\n` +
            `  "version" INTEGER NOT NULL,\n` +
            `  "updated_at" INTEGER NOT NULL\n` +
            `);`,
        );

        const existing = handle.all<{ name: string }>('SELECT "name" FROM "metadata";');
        const statements = pendingSeedStatements(new Set(existing.map((row) => row.name.toLowerCase())));
        if (statements.length > 0) {
          handle.exec("BEGIN IMMEDIATE;");
          try {
            runStatements(handle, statements);
            bumpResourceVersion(handle, CONTENT_TYPES_RESOURCE);
            handle.exec("COMMIT;");
          } catch (error) {
            handle.exec("ROLLBACK;");
            throw error;
          }
        }

        handle.exec(permissionUniqueIndexStatement().sql);

        // Keep `permission` in sync with every current collection/singleton
        // (including ones seeded on a prior boot, e.g. `user`/`menu` on an
        // app upgrading to a drycms version that just added `role`/
        // `permission`), and (re-)seed the permanent Super Admin role.
        // Idempotent and cheap - safe to run unconditionally every boot.
        const allTypes = handle
          .all<{ definition: string }>('SELECT "definition" FROM "metadata";')
          .map((row) => JSON.parse(row.definition) as ContentTypeDefinition);
        const syncStatements = allTypes.flatMap(permissionSyncStatements);
        handle.exec("BEGIN IMMEDIATE;");
        try {
          runStatements(handle, [...syncStatements, superAdminSeedStatement()]);
          handle.exec("COMMIT;");
        } catch (error) {
          handle.exec("ROLLBACK;");
          throw error;
        }

        return handle;
      });
    }
    return handlePromise;
  }

  async function listContentTypes(): Promise<ContentTypeDefinition[]> {
    const handle = await getHandle();
    const rows = handle.all<{ definition: string }>('SELECT "definition" FROM "metadata";');
    return rows.map((row) => JSON.parse(row.definition) as ContentTypeDefinition);
  }

  async function getContentType(id: string): Promise<ContentTypeDefinition | null> {
    const handle = await getHandle();
    const rows = handle.all<{ definition: string }>('SELECT "definition" FROM "metadata" WHERE "id" = ?;', [id]);
    return rows[0] ? (JSON.parse(rows[0].definition) as ContentTypeDefinition) : null;
  }

  async function planSave(next: ContentTypeDefinition): Promise<SavePlan> {
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
    const newAllTypes = [...oldAllTypes.filter((t) => t.id !== next.id), next];
    return planSaveEngine({ savedType: next, oldAllTypes, newAllTypes });
  }

  async function applySave(next: ContentTypeDefinition, plan: SavePlan): Promise<ContentTypeDefinition> {
    const handle = await getHandle();
    const allPlans = [plan.primary, ...plan.cascaded];

    // A stale plan (a concurrent edit landed between planSave() and this
    // call) must never be replayed against a schema it no longer matches -
    // re-verify every affected content type is still at the version the
    // plan was computed against, before running a single statement.
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
        for (const p of allPlans) {
          const result = handle.run(p.metadataStatement.sql, p.metadataStatement.params ?? []);
          if (result.changes === 0) {
            throw new ContentEngineError(
              "version_conflict",
              `Metadata write for "${p.targetContentTypeId}" was rejected (version conflict).`,
            );
          }
        }
        runStatements(handle, permissionSyncStatements(next));
        bumpResourceVersion(handle, CONTENT_TYPES_RESOURCE);
        handle.exec("COMMIT;");
      } catch (error) {
        handle.exec("ROLLBACK;");
        throw error;
      }
    } finally {
      if (needsForeignKeysOff) handle.exec("PRAGMA foreign_keys = ON;");
    }

    const saved = await getContentType(next.id);
    if (!saved) throw new ContentEngineError("not_found", `Content type "${next.id}" not found after save.`);
    return saved;
  }

  async function deleteContentType(id: string): Promise<void> {
    const handle = await getHandle();
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
    handle.exec("BEGIN IMMEDIATE;");
    try {
      runStatements(handle, dropStatements);
      handle.run('DELETE FROM "metadata" WHERE "id" = ?;', [id]);
      runStatements(handle, permissionDeleteStatements(existing));
      bumpResourceVersion(handle, CONTENT_TYPES_RESOURCE);
      handle.exec("COMMIT;");
    } catch (error) {
      handle.exec("ROLLBACK;");
      throw error;
    }
  }

  return {
    listContentTypes,
    getContentType,
    planSave,
    applySave,
    deleteContentType,
    getResourceVersion: async () => {
      const handle = await getHandle();
      return getResourceVersion(handle, CONTENT_TYPES_RESOURCE);
    },
  };
}
