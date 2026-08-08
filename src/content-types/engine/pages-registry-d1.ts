import type { ResolvedD1ContentOption } from "../../server/options.js";
import { ContentEngineError } from "./types.js";
import type { D1Database } from "./d1-driver.js";
import type { PageDependency, PageRecord, PagesRegistryAdapter, StalePageInfo } from "./pages-registry-types.js";

interface PageRow {
  path: string;
  object_key: string;
  build_id: string;
  built_at: number;
  in_sitemap: number;
  publish_at: number | null;
}

function toPageRecord(row: PageRow): PageRecord {
  return {
    path: row.path,
    objectKey: row.object_key,
    buildId: row.build_id,
    builtAt: row.built_at,
    inSitemap: row.in_sitemap === 1,
    publishAt: row.publish_at,
  };
}

/** Same per-binding memoization as `d1.ts`/`entries-d1.ts` - one bootstrap
 * per live binding for the isolate's lifetime, not one per request. */
const bootstrapByBinding = new WeakMap<D1Database, Promise<void>>();

export function createD1PagesRegistryAdapter(
  option: ResolvedD1ContentOption,
  runtimeEnv: Record<string, unknown> | undefined,
): PagesRegistryAdapter {
  const maybeDb = runtimeEnv?.[option.binding] as D1Database | undefined;
  if (!maybeDb) {
    throw new ContentEngineError(
      "unsupported",
      `[drycms] D1 binding "${option.binding}" was not found on the request env - check wrangler.jsonc's d1_databases config.`,
    );
  }
  const db: D1Database = maybeDb;

  async function ensureBootstrap(): Promise<void> {
    let bootstrapped = bootstrapByBinding.get(db);
    if (!bootstrapped) {
      bootstrapped = (async () => {
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS "_pages" (\n` +
              `  "path" TEXT PRIMARY KEY,\n` +
              `  "object_key" TEXT NOT NULL,\n` +
              `  "build_id" TEXT NOT NULL,\n` +
              `  "built_at" INTEGER NOT NULL,\n` +
              `  "in_sitemap" INTEGER NOT NULL,\n` +
              `  "publish_at" INTEGER\n` +
              `);`,
          )
          .run();
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS "_page_deps" (\n` +
              `  "path" TEXT NOT NULL,\n` +
              `  "resource" TEXT NOT NULL,\n` +
              `  "version" INTEGER NOT NULL,\n` +
              `  PRIMARY KEY ("path", "resource")\n` +
              `);`,
          )
          .run();
        await db.prepare(`CREATE INDEX IF NOT EXISTS "ix_page_deps_resource" ON "_page_deps"("resource");`).run();
        // Own copy, same reasoning as the sqlite adapter's - see that
        // file's doc comment.
        await db
          .prepare(
            `CREATE TABLE IF NOT EXISTS "_versions" (\n` +
              `  "resource" TEXT PRIMARY KEY,\n` +
              `  "version" INTEGER NOT NULL,\n` +
              `  "updated_at" INTEGER NOT NULL\n` +
              `);`,
          )
          .run();
      })();
      bootstrapByBinding.set(db, bootstrapped);
      bootstrapped.catch(() => bootstrapByBinding.delete(db));
    }
    return bootstrapped;
  }

  return {
    async recordBuild(record, deps: PageDependency[]) {
      await ensureBootstrap();
      // D1 has no cross-statement transaction the way local SQLite does -
      // `.batch()` is atomic per call, same tradeoff `d1.ts`'s `applySave`
      // already documents. One batch for the whole recordBuild (upsert +
      // dep replace) keeps it atomic as a single unit.
      const statements = [
        db
          .prepare(
            'INSERT INTO "_pages" ("path","object_key","build_id","built_at","in_sitemap","publish_at") VALUES (?,?,?,?,?,?) ' +
              'ON CONFLICT("path") DO UPDATE SET ' +
              '"object_key"=excluded."object_key", "build_id"=excluded."build_id", "built_at"=excluded."built_at", ' +
              '"in_sitemap"=excluded."in_sitemap", "publish_at"=excluded."publish_at";',
          )
          .bind(record.path, record.objectKey, record.buildId, record.builtAt, record.inSitemap ? 1 : 0, record.publishAt),
        db.prepare('DELETE FROM "_page_deps" WHERE "path" = ?;').bind(record.path),
        ...deps.map((dep) =>
          db.prepare('INSERT INTO "_page_deps" ("path","resource","version") VALUES (?,?,?);').bind(record.path, dep.resource, dep.version),
        ),
      ];
      await db.batch(statements);
    },

    async removePage(path) {
      await ensureBootstrap();
      await db.batch([
        db.prepare('DELETE FROM "_pages" WHERE "path" = ?;').bind(path),
        db.prepare('DELETE FROM "_page_deps" WHERE "path" = ?;').bind(path),
      ]);
    },

    async listAllPages() {
      await ensureBootstrap();
      const result = await db.prepare('SELECT * FROM "_pages" ORDER BY "path" ASC;').all<PageRow>();
      return (result.results ?? []).map(toPageRecord);
    },

    async listPathsByResource(resource) {
      await ensureBootstrap();
      const result = await db.prepare('SELECT DISTINCT "path" FROM "_page_deps" WHERE "resource" = ?;').bind(resource).all<{ path: string }>();
      return (result.results ?? []).map((row) => row.path);
    },

    async listSitemapEntries(asOfMs) {
      await ensureBootstrap();
      const result = await db
        .prepare('SELECT "path", "built_at" FROM "_pages" WHERE "in_sitemap" = 1 AND ("publish_at" IS NULL OR "publish_at" <= ?);')
        .bind(asOfMs)
        .all<{ path: string; built_at: number }>();
      return (result.results ?? []).map((row) => ({ path: row.path, builtAt: row.built_at }));
    },

    async listStalePaths() {
      await ensureBootstrap();
      const result = await db
        .prepare(
          'SELECT d."path" AS path, d."resource" AS resource FROM "_page_deps" d ' +
            'JOIN "_versions" v ON v."resource" = d."resource" WHERE v."version" != d."version";',
        )
        .all<{ path: string; resource: string }>();
      const byPath = new Map<string, StalePageInfo>();
      for (const row of result.results ?? []) if (!byPath.has(row.path)) byPath.set(row.path, { path: row.path, resource: row.resource });
      return [...byPath.values()];
    },

    async listDueForPublish(asOfMs) {
      await ensureBootstrap();
      const result = await db
        .prepare('SELECT * FROM "_pages" WHERE "publish_at" IS NOT NULL AND "publish_at" <= ?;')
        .bind(asOfMs)
        .all<PageRow>();
      return (result.results ?? []).map(toPageRecord);
    },

    async markPublished(path, objectKey) {
      await ensureBootstrap();
      await db.prepare('UPDATE "_pages" SET "object_key" = ?, "publish_at" = NULL WHERE "path" = ?;').bind(objectKey, path).run();
    },

    async nextPublishAt(afterMs) {
      await ensureBootstrap();
      const result = await db
        .prepare('SELECT MIN("publish_at") AS "next" FROM "_pages" WHERE "publish_at" IS NOT NULL AND "publish_at" > ?;')
        .bind(afterMs)
        .all<{ next: number | null }>();
      return result.results?.[0]?.next ?? null;
    },
  };
}
