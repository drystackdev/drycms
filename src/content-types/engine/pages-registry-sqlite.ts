import type { ResolvedSqliteContentOption } from "../../server/options.js";
import { resolveSqliteDriver, type SqliteHandle } from "./sqlite-driver.js";
import type { PageDependency, PageRecord, PagesRegistryAdapter, StalePageInfo } from "./pages-registry-types.js";

interface PageRow {
  path: string;
  object_key: string;
  build_id: string;
  built_at: number;
  in_sitemap: number;
}

function toPageRecord(row: PageRow): PageRecord {
  return {
    path: row.path,
    objectKey: row.object_key,
    buildId: row.build_id,
    builtAt: row.built_at,
    inSitemap: row.in_sitemap === 1,
  };
}

export function createSqlitePagesRegistryAdapter(option: ResolvedSqliteContentOption): PagesRegistryAdapter {
  let handlePromise: Promise<SqliteHandle> | undefined;

  async function getHandle(): Promise<SqliteHandle> {
    if (!handlePromise) {
      handlePromise = resolveSqliteDriver(option.file).then((handle) => {
        // `publish_at` used to back a page-level "schedule" build - removed
        // in favor of the entry-level `features.schedule` gate alone
        // (`entry-where.ts`'s `buildPublishedOnlyClause`). Not dropped from
        // any EXISTING local database (no migration runs here), just no
        // longer read/written - a pre-existing column sits unused, harmless.
        handle.exec(
          `CREATE TABLE IF NOT EXISTS "_pages" (\n` +
            `  "path" TEXT PRIMARY KEY,\n` +
            `  "object_key" TEXT NOT NULL,\n` +
            `  "build_id" TEXT NOT NULL,\n` +
            `  "built_at" INTEGER NOT NULL,\n` +
            `  "in_sitemap" INTEGER NOT NULL\n` +
            `);`,
        );
        handle.exec(
          `CREATE TABLE IF NOT EXISTS "_page_deps" (\n` +
            `  "path" TEXT NOT NULL,\n` +
            `  "resource" TEXT NOT NULL,\n` +
            `  "version" INTEGER NOT NULL,\n` +
            `  PRIMARY KEY ("path", "resource")\n` +
            `);`,
        );
        handle.exec(`CREATE INDEX IF NOT EXISTS "ix_page_deps_resource" ON "_page_deps"("resource");`);
        // Same shape as `entries-sqlite.ts`'s copy - queried here via a JOIN
        // (`listStalePaths`), but bootstrapped independently rather than
        // relying on the entries adapter having run first (this codebase's
        // established precedent - see that file's own doc comment on why
        // `_versions"` is duplicated per engine adapter rather than shared).
        handle.exec(
          `CREATE TABLE IF NOT EXISTS "_versions" (\n` +
            `  "resource" TEXT PRIMARY KEY,\n` +
            `  "version" INTEGER NOT NULL,\n` +
            `  "updated_at" INTEGER NOT NULL\n` +
            `);`,
        );
        return handle;
      });
    }
    return handlePromise;
  }

  return {
    async recordBuild(record, deps) {
      const handle = await getHandle();
      handle.exec("BEGIN IMMEDIATE;");
      try {
        handle.run(
          'INSERT INTO "_pages" ("path","object_key","build_id","built_at","in_sitemap") VALUES (?,?,?,?,?) ' +
            'ON CONFLICT("path") DO UPDATE SET ' +
            '"object_key"=excluded."object_key", "build_id"=excluded."build_id", "built_at"=excluded."built_at", ' +
            '"in_sitemap"=excluded."in_sitemap";',
          [record.path, record.objectKey, record.buildId, record.builtAt, record.inSitemap ? 1 : 0],
        );
        handle.run('DELETE FROM "_page_deps" WHERE "path" = ?;', [record.path]);
        for (const dep of deps) {
          handle.run('INSERT INTO "_page_deps" ("path","resource","version") VALUES (?,?,?);', [record.path, dep.resource, dep.version]);
        }
        handle.exec("COMMIT;");
      } catch (error) {
        handle.exec("ROLLBACK;");
        throw error;
      }
    },

    async removePage(path) {
      const handle = await getHandle();
      handle.exec("BEGIN IMMEDIATE;");
      try {
        handle.run('DELETE FROM "_pages" WHERE "path" = ?;', [path]);
        handle.run('DELETE FROM "_page_deps" WHERE "path" = ?;', [path]);
        handle.exec("COMMIT;");
      } catch (error) {
        handle.exec("ROLLBACK;");
        throw error;
      }
    },

    async clearAllPages() {
      const handle = await getHandle();
      handle.exec("BEGIN IMMEDIATE;");
      try {
        handle.run('DELETE FROM "_page_deps";');
        handle.run('DELETE FROM "_pages";');
        handle.exec("COMMIT;");
      } catch (error) {
        handle.exec("ROLLBACK;");
        throw error;
      }
    },

    async listAllPages() {
      const handle = await getHandle();
      const rows = handle.all<PageRow>('SELECT "path","object_key","build_id","built_at","in_sitemap" FROM "_pages" ORDER BY "path" ASC;');
      return rows.map(toPageRecord);
    },

    async listPathsByResource(resource) {
      const handle = await getHandle();
      const rows = handle.all<{ path: string }>('SELECT DISTINCT "path" FROM "_page_deps" WHERE "resource" = ?;', [resource]);
      return rows.map((row) => row.path);
    },

    async listResourcesByPath(path) {
      const handle = await getHandle();
      const rows = handle.all<{ resource: string }>('SELECT DISTINCT "resource" FROM "_page_deps" WHERE "path" = ?;', [path]);
      return rows.map((row) => row.resource);
    },

    async listSitemapEntries() {
      const handle = await getHandle();
      const rows = handle.all<{ path: string; built_at: number }>('SELECT "path", "built_at" FROM "_pages" WHERE "in_sitemap" = 1;');
      return rows.map((row) => ({ path: row.path, builtAt: row.built_at }));
    },

    async listStalePaths() {
      const handle = await getHandle();
      const rows = handle.all<{ path: string; resource: string }>(
        'SELECT d."path" AS path, d."resource" AS resource FROM "_page_deps" d ' +
          'JOIN "_versions" v ON v."resource" = d."resource" WHERE v."version" != d."version";',
      );
      const byPath = new Map<string, StalePageInfo>();
      for (const row of rows) if (!byPath.has(row.path)) byPath.set(row.path, { path: row.path, resource: row.resource });
      return [...byPath.values()];
    },
  };
}
