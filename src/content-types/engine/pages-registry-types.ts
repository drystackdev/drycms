/** One built page's current state - `plans/app-r2.md` mục 5. `path` is the
 * public pathname (`"/blogs/abc"`, `"/"` for root - same normalization
 * `pages-cache.ts`'s `cacheKeyFor` already does, reused here). */
export interface PageRecord {
  path: string;
  /** Immutable object key this page's CURRENT (live) build lives at, e.g.
   * `pages/<buildHash>/blogs/abc.html` - `plans/app-r2.md` quyết định #7.
   * Reference for admin/rollback tooling only; the serve path never reads
   * this per-request (mục 12) - it reads a stable pathname-derived key that
   * `recordBuild`'s caller keeps in sync with whatever this points to. */
  objectKey: string;
  buildId: string;
  builtAt: number;
  /** Whether this page belongs in `sitemap.xml` - `false` for `noIndex`,
   * `404.tsx`/`500.tsx` fallbacks, or anything else `sitemap.ts` shouldn't
   * list. Decided at build time (the page was actually rendered, so its real
   * SEO cascade is known - see mục 8's "hạn chế biến mất" note), not
   * re-derived at sitemap-serve time. */
  inSitemap: boolean;
  /** `null` = already live. A future timestamp (ms epoch) = this build is
   * staged for `schedule` (mục 9) - cron flips it live once due, this
   * column is what the sitemap query and the cron sweep both filter on. */
  publishAt: number | null;
}

/** One content-type dependency a built page's render actually touched -
 * mirrors `page-handler.ts`'s `touchedTypes`, persisted so a later edit to
 * that resource can look up which pages to rebuild (mục 5's `_page_deps`). */
export interface PageDependency {
  resource: string;
  version: number;
}

export interface StalePageInfo {
  path: string;
  /** The dependency whose version moved since this page was last built -
   * only the FIRST one found for a given path (there may be several); enough
   * for an admin "stale" badge to say why, not a full diff. */
  resource: string;
}

/**
 * Dual-engine (SQLite/D1) registry for built-page metadata - same
 * standalone-per-engine shape as `engine/sqlite.ts`/`engine/d1.ts` and
 * `engine/entries-sqlite.ts`/`engine/entries-d1.ts` (own connection, own
 * bootstrap DDL, no shared connection object) rather than folding into the
 * entries engine: `_pages`/`_page_deps` aren't content-type data, they're
 * app-router build metadata, and `_versions` (queried here via a JOIN, see
 * `listStalePaths`) lives in the SAME physical database/binding regardless
 * of which adapter object issued the query - see `status/app-r2-build.md`.
 */
export interface PagesRegistryAdapter {
  /** Upserts `record` and fully replaces its dependency set - one call per
   * built page. Atomic per engine's own means (a local-SQLite transaction;
   * a single D1 `.batch()`). */
  recordBuild(record: PageRecord, deps: PageDependency[]): Promise<void>;
  /** Removes a page's row + deps - called when a page/entry is deleted, so
   * a stale row never keeps pointing `sitemap.xml`/rollback at content
   * that no longer exists (mục 5's "phải dọn row khi xoá"). */
  removePage(path: string): Promise<void>;
  /** Every path that depends on `resource` - "what needs rebuilding when
   * this content type changes". */
  listPathsByResource(resource: string): Promise<string[]>;
  /** Sitemap source of truth (mục 8): every in-sitemap page whose
   * `publishAt` is null or already past `asOfMs`. */
  listSitemapEntries(asOfMs: number): Promise<{ path: string; builtAt: number }[]>;
  /** Admin "stale" list (mục 11): paths whose recorded dependency version no
   * longer matches `_versions`' current value for that resource. */
  listStalePaths(): Promise<StalePageInfo[]>;
  /** Cron flip candidates (mục 9): staged builds due to go live. */
  listDueForPublish(asOfMs: number): Promise<PageRecord[]>;
  /** Cron/admin: flips a page's live pointer to `objectKey` and clears
   * `publishAt` - called AFTER the caller has already copied that
   * immutable object's bytes onto the stable live key (mục 12); this only
   * updates the registry's bookkeeping, it does no storage I/O itself. */
  markPublished(path: string, objectKey: string): Promise<void>;
  /** Earliest `publishAt` still in the future, or `null` if nothing's
   * scheduled - shared by mục 14 (sitemap edge-cache TTL cap) and mục 9
   * (cron's own fast, empty-case exit). */
  nextPublishAt(afterMs: number): Promise<number | null>;
}
