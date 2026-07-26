import type { ResolvedSqliteContentOption } from "../../integration/options.js";
import { planDelete, planSave as planSaveEngine, type SavePlan, type Statement } from "../migration.js";
import { findDependents } from "../tree.js";
import type { ContentTypeDefinition } from "../types.js";
import { ContentEngineError, type ContentEngineAdapter } from "./types.js";

interface SqliteHandle {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): { changes: number };
  all<T = unknown>(sql: string, params?: unknown[]): T[];
}

function wrapBunSqlite(DatabaseCtor: any, file: string): SqliteHandle {
  const db = new DatabaseCtor(file);
  return {
    exec(sql) {
      db.run(sql);
    },
    run(sql, params = []) {
      const result = db.run(sql, ...params);
      return { changes: result?.changes ?? 0 };
    },
    all(sql, params = []) {
      return db.query(sql).all(...params);
    },
  };
}

function wrapNodeSqlite(DatabaseSyncCtor: any, file: string): SqliteHandle {
  const db = new DatabaseSyncCtor(file);
  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
}

function wrapBetterSqlite3(DatabaseCtor: any, file: string): SqliteHandle {
  const db = new DatabaseCtor(file);
  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes };
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
}

/** Takes the module specifier as a runtime value (not a string literal) on
 * purpose: TypeScript only attempts to resolve/typecheck a dynamic `import()`
 * whose argument is a literal, so routing it through a `string`-typed
 * parameter here sidesteps needing ambient types (or a real dependency) for
 * `bun:sqlite`/`node:sqlite`/the optional `better-sqlite3` peer dependency -
 * exactly one of which is expected to actually resolve at runtime, depending
 * on the host platform. */
async function tryImport(specifier: string): Promise<any | undefined> {
  try {
    return await import(/* @vite-ignore */ specifier);
  } catch {
    return undefined;
  }
}

async function resolveSqliteDriver(file: string): Promise<SqliteHandle> {
  const bun = await tryImport("bun:sqlite");
  if (bun) return wrapBunSqlite(bun.Database, file);

  const node = await tryImport("node:sqlite");
  if (node) return wrapNodeSqlite(node.DatabaseSync, file);

  const better = await tryImport("better-sqlite3");
  if (better) return wrapBetterSqlite3(better.default ?? better, file);

  throw new ContentEngineError(
    "unsupported",
    '[drycms] content.engine "sqlite" needs one of bun:sqlite, node:sqlite (Node 22.5+), or the optional peer dependency "better-sqlite3" (run `bun add better-sqlite3`) - none were available.',
  );
}

function runStatements(handle: SqliteHandle, statements: Statement[]): void {
  for (const stmt of statements) handle.run(stmt.sql, stmt.params ?? []);
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
      handle.exec("COMMIT;");
    } catch (error) {
      handle.exec("ROLLBACK;");
      throw error;
    }
  }

  return { listContentTypes, getContentType, planSave, applySave, deleteContentType };
}
