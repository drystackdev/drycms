import type { DryCallLogEntry } from "./dry-context.js";
import { fetchDryHttp } from "./dry-http-cache.js";
import { createInertRefProxy } from "./dry-vei.js";
import { seoTierFor, type DrySeoLayers, type DrySeoValue } from "./dry-seo.js";
import type { ContentTypeDefinition } from "./types.js";
import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import type {
  DryCollectionReader,
  DryGetOptions,
  DryListOptions,
  DryReader,
  DrySelect,
  DrySingletonReader,
} from "./dry-reader.js";

/**
 * `dry()`'s THIRD variant - `plans/app-r2.md` mục 3. `dry-reader.ts` (server,
 * `AsyncLocalStorage`+DB) and `dry-reader-client.ts` (hydration, replays an
 * already-fetched log) both assume something this environment doesn't have:
 * a live DB connection, or a pre-existing log to replay. The browser BUILD
 * pipeline needs a third thing - fetch fresh, published-only data over HTTP,
 * from the admin tab, while still producing the SAME `DryCallLogEntry[]`
 * shape `dry-replay-codec.ts` already knows how to embed for hydration
 * (reused directly here, not reimplemented - see `decodeCallLog` below).
 *
 * Not wired into `app-router-plugin.ts`'s ambient-global injection (that
 * only fires inside Vite's OWN transform pipeline - dev SSR / the normal
 * client bundle). The browser build compiles `page.tsx` source with Sucrase
 * at runtime instead, entirely outside Vite's plugin graph, so THIS module
 * has no bare-global caller to satisfy - `configureHttpDryReader` is called
 * directly by the build orchestrator, and `dry` is passed into the evaluated
 * page module as a `new Function(...)` parameter, the same trick used for
 * `h`/`Fragment` (see whatever calls `evalPageComponent`-equivalent for the
 * build path).
 */

/** One resource this build's `dry()` calls touched, and its version AT THE
 * MOMENT it was read - what `_page_deps` (`plans/app-r2.md` mục 5) needs to
 * answer "rebuild this page when that resource changes". Deliberately the
 * same shape as `engine/pages-registry-types.ts`'s `PageDependency` but not
 * imported from there - this module ships to the browser, that one imports
 * server-only D1/SQLite driver code transitively. */
export interface HttpDryReaderDependency {
  resource: string;
  version: number;
}

export interface HttpDryReaderConfig {
  /** `${adminPath}/api/dry-http` - same-origin as the admin tab regardless
   * of what public origin the built HTML will be served from (the build
   * runs in the admin tab; the site's origin only matters for the OUTPUT
   * HTML's canonical/og:url tags, not for this fetch). */
  endpoint: string;
  /** Every `dry()` call this build makes, in order - read by the build
   * orchestrator once rendering finishes, embedded the same way
   * `render.ts` embeds the server's own `callLog` for hydration. Mutated by
   * this module; the caller owns the array identity so it can read it back
   * without a second accessor. */
  callLog: DryCallLogEntry[];
  /** One entry per `dry()` call (may repeat the same resource - the caller
   * dedupes/keeps-latest before writing `_page_deps`), read off
   * `routes/dry-http.ts`'s `X-Dry-Resource`/`X-Dry-Resource-Version`
   * response headers. Same "caller owns the array, this module only pushes"
   * contract as `callLog`. */
  deps: HttpDryReaderDependency[];
  /** Content types, for the SAME "a page's own `get()` automatically feeds
   * the SEO cascade" behavior `dry-reader.ts`'s `recordSeoLayer` gives the
   * server path (`reader.md`'s "tự động đọc" requirement) - without this,
   * a built page would silently lose entry/singleton-driven `<title>`/OG
   * tags relative to a normal SSR render of the same page. */
  allTypes: ContentTypeDefinition[];
  /** Mutated the same way `DryRequestContext.seo` is - the orchestrator
   * passes this straight into `BuildDocumentContext.seo` after rendering. */
  seo: DrySeoLayers;
  seoEntryDates?: { createdAt?: string; updatedAt?: string };
  /** How long a `dry()` response may be reused from IndexedDB instead of
   * refetched - see `dry-http-cache.ts`. Set ONLY by the page editor's live
   * preview; every publishing build leaves it unset and fetches fresh. */
  cacheTtlMs?: number;
}

let config: HttpDryReaderConfig | null = null;

/** Must be called before evaluating a page/layout that might call `dry()` -
 * one call per page build (sequential builds, not concurrent - see the
 * module doc comment's "no AsyncLocalStorage needed" reasoning, same as
 * `dry-reader-client.ts`). */
export function configureHttpDryReader(next: HttpDryReaderConfig): void {
  config = next;
}

function activeConfig(): HttpDryReaderConfig {
  if (!config) {
    throw new Error("[drycms] dry() (HTTP build variant) was called before configureHttpDryReader().");
  }
  return config;
}

/** Same purpose as `dry-reader-client.ts`'s identically-named helper: a
 * decoded HTTP response carries no `$` of its own (`markRecord`'s real `$`
 * is a non-enumerable property - `JSON.stringify` drops it, so it can't
 * have survived the round trip either way) - grafts an inert one so
 * `dryBind(post.$.title)` calls in real page code don't throw. Real VEI
 * boxing never applies to a build-time render (no live editing session),
 * so "inert" is the correct behavior here, not a shortcut. */
function withInertRefs<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.defineProperty(value, "$", { value: createInertRefProxy(), enumerable: false, configurable: true });
  }
  return value;
}

interface WireRequest {
  kind: "collection" | "singleton";
  name: string;
  method: "get" | "list";
  idOrSlug?: number | string;
  populate?: string[];
  /** `list()` only - field NAMES, never the `select` functions themselves
   * (can't cross HTTP - see `applyLocalTransforms` below). */
  selectFields?: string[];
  where?: unknown;
  sort?: { field: string; dir?: "asc" | "desc" };
  page?: number;
  pageSize?: number;
  include?: string[];
}

/** Verbatim port of `dry-reader.ts`'s `recordSeoLayer` (server) - same
 * lookup, same tier assignment, same entry-dates side effect. Not called
 * from `list()`, same as the original - a listing row isn't "the page's own"
 * entity. `result.createdAt`/`updatedAt` here are already real `Date`
 * instances (`decodeCallLog`'s job, see `dry-replay-codec.ts`), not
 * strings - same as the server path reading them off `entry-codec.ts`'s
 * deserialize. */
function recordSeoLayer(config: HttpDryReaderConfig, name: string, result: Record<string, unknown> | null): void {
  if (!result) return;
  const type = config.allTypes.find((t) => t.name === name);
  if (!type) return;
  const tier = seoTierFor(type);
  if (!tier) return;
  const seo = result.seo;
  if (seo && typeof seo === "object") config.seo[tier] = seo as DrySeoValue;
  if (tier === "entry" && type.features?.timestamps) {
    config.seoEntryDates = {
      createdAt: result.createdAt instanceof Date ? result.createdAt.toISOString() : undefined,
      updatedAt: result.updatedAt instanceof Date ? result.updatedAt.toISOString() : undefined,
    };
  }
}

async function callServer(body: WireRequest): Promise<DryCallLogEntry> {
  const { endpoint, callLog, deps, cacheTtlMs } = activeConfig();
  let response;
  try {
    response = await fetchDryHttp(endpoint, body, cacheTtlMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[drycms] dry().${body.kind}("${body.name}").${body.method}() failed: ${reason}.`);
  }
  const [entry] = decodeCallLog(response.text);
  if (!entry) throw new Error(`[drycms] dry().${body.kind}("${body.name}").${body.method}() returned no result.`);
  callLog.push(entry);
  // Pushed for a cache hit too, with the version as of when it was cached -
  // `_page_deps` stays populated either way, and the only caller that
  // enables the cache (the live preview) never publishes those deps.
  if (response.resource) deps.push({ resource: response.resource, version: response.version });
  return entry;
}

/** `select`'s function transforms only exist as real JS in the page module
 * that's currently being evaluated IN THIS TAB - they can never be sent to
 * the server (that would mean asking the server to eval arbitrary code,
 * exactly what decision #2 rules out). So the wire request only ever
 * carries field NAMES (the server still applies the real projection - a
 * listing page genuinely doesn't fetch/log columns it didn't ask for); the
 * transform itself runs here, once, on the raw values that come back -
 * same "runs once, result gets logged" contract `dry-reader.ts`'s own
 * `applyTransforms` documents, just relocated to the browser. */
function applyLocalTransforms(record: Record<string, unknown>, select: DrySelect<Record<string, unknown>> | undefined): Record<string, unknown> {
  if (!select) return record;
  for (const [field, value] of Object.entries(select)) {
    if (typeof value === "function") record[field] = (value as (v: unknown) => unknown)(record[field]);
  }
  return record;
}

function createCollectionReader(name: string): DryCollectionReader<Record<string, unknown>> {
  return {
    async get(idOrSlug: number | string, options?: DryGetOptions<string>) {
      const entry = await callServer({ kind: "collection", name, method: "get", idOrSlug, populate: options?.populate });
      recordSeoLayer(activeConfig(), name, entry.result as Record<string, unknown> | null);
      return withInertRefs(entry.result as Record<string, unknown> | null);
    },
    async list(options: DryListOptions<Record<string, unknown>> & { select?: DrySelect<Record<string, unknown>> } = {}) {
      const entry = await callServer({
        kind: "collection",
        name,
        method: "list",
        selectFields: options.select ? Object.keys(options.select) : undefined,
        where: options.where,
        sort: options.sort,
        page: options.page,
        pageSize: options.pageSize,
        include: options.include,
        // `includeDraft` is deliberately never sent - the server endpoint
        // never reads a draft-inclusion flag from the request at all (see
        // `routes/dry-http.ts`'s doc comment), so there's nothing to trust
        // or distrust on this side either.
      });
      const page = entry.result as { rows: Record<string, unknown>[]; total: number };
      return {
        rows: page.rows.map((row) => withInertRefs(applyLocalTransforms(row, options.select))),
        total: page.total,
      };
    },
  } as DryCollectionReader<Record<string, unknown>>;
}

function createSingletonReader(name: string): DrySingletonReader<Record<string, unknown>> {
  return {
    async get(options?: DryGetOptions<string>) {
      const entry = await callServer({ kind: "singleton", name, method: "get", populate: options?.populate });
      recordSeoLayer(activeConfig(), name, entry.result as Record<string, unknown> | null);
      return withInertRefs(entry.result as Record<string, unknown> | null);
    },
  } as DrySingletonReader<Record<string, unknown>>;
}

export function dry(): DryReader {
  return {
    collection: (name) => createCollectionReader(name),
    singleton: (name) => createSingletonReader(name),
  };
}
