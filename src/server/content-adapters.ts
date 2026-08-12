import { content, kv } from "./config.js";
import type { DryRouteContext } from "./context.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter, createPagesRegistryAdapter } from "../content-types/engine/index.js";
import type { ContentEntryEngineAdapter, EntryRow } from "../content-types/engine/entries-types.js";
import type { ContentEngineAdapter } from "../content-types/engine/types.js";
import type { PagesRegistryAdapter } from "../content-types/engine/pages-registry-types.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { createRequestKeyValueAdapter } from "../kv/factory.js";
import { KeyValueStore } from "../kv/memory.js";

export interface ContentAdapters {
  schema: ContentEngineAdapter;
  entries: ContentEntryEngineAdapter;
  pagesRegistry: PagesRegistryAdapter;
}

/**
 * SQLite and file adapters are safe to share for the life of the module. D1
 * adapters contain a live request binding, so they are created once per route
 * context instead. Keeping both decisions here prevents every route from
 * reimplementing the same runtime split.
 */
const moduleAdapters: ContentAdapters | undefined = content.engine !== "D1"
  ? {
      schema: createContentEngineAdapter(content),
      entries: createContentEntryEngineAdapter(content),
      pagesRegistry: createPagesRegistryAdapter(content),
    }
  : undefined;

const requestAdapters = new WeakMap<object, ContentAdapters>();

const SCHEMA_CACHE_NAMESPACE = "schema-cache";
const CONTENT_TYPES_CACHE_KEY = "content-types";
const ROLES_CACHE_KEY = "roles";
const SYSTEM_SETTINGS_CACHE_KEY = "system-settings";
/** Bounds how long a stale value can survive an isolate/edge that missed an
 * `applySave`/role-write's own explicit cache-clear (see `withCachedSchema`/
 * `withCachedRoleReads` below) - the writer's OWN isolate clears
 * immediately, and KV propagation to other edge locations is normally much
 * faster than this, so 30s is a worst-case ceiling, not the expected
 * staleness window. */
const CACHE_TTL_MS = 30_000;

/**
 * One `KeyValueStore` per isolate, reused across every request - keyed by
 * the resolved KV BINDING object rather than `context.env` (a fresh object
 * every request): a Cloudflare binding value is the same reference for the
 * isolate's whole life, same reasoning `content-types/engine/d1.ts`'s
 * `bootstrappedBindings`/`versionsTableReady` already rely on. `cache: true`
 * gives this store its OWN in-process Map on top of the real KV round trip
 * (`kv/memory.ts`'s `KeyValueStore`), so a warm isolate serves
 * `listContentTypes()`/role reads from memory with no I/O at all; a cold
 * isolate (or one whose in-memory copy just expired) falls through to KV
 * instead of D1 - moving the read off the D1 free-tier quota entirely for
 * the common case. Only ever built for the Cloudflare deployment
 * (`content.engine === "D1"` implies `kv.kind === "KV"` - both are derived
 * from the same top-level `kind` in `options.ts`): the sqlite/file engines
 * already read from in-process storage with no quota to protect, so
 * wrapping them here would be pure overhead for no benefit.
 */
const schemaCacheStores = new WeakMap<object, KeyValueStore>();

/**
 * This cache exists purely to take load off D1; it must never make a
 * request WORSE than having no cache at all. `KeyValueStore.get` only
 * swallows a backend error into `null` when it finds a STALE cached copy to
 * fall back to (`allowStaleOnError`) - on a true cold miss (nothing cached
 * yet in this isolate) a KV outage would otherwise throw and fail the whole
 * request, so every read here treats a KV error exactly like a miss and
 * falls through to the real adapter call. `set`/`delete` get the same
 * guard even though `durability: "async"` normally keeps them from
 * throwing synchronously (they queue the backend write/delete in the
 * background) - `set` still reads the existing record first to compute
 * `version`/`createdAt` when the local cache is cold, which CAN surface a
 * backend error synchronously; either way, a failed cache write should
 * never fail the D1 write that already succeeded before it.
 */
async function safeGet<T>(store: KeyValueStore, namespace: string, key: string): Promise<T | null> {
  try {
    return await store.get<T>(namespace, key, { allowStaleOnError: true });
  } catch {
    return null;
  }
}

async function safeSet<T>(store: KeyValueStore, namespace: string, key: string, value: T, ttlMs: number): Promise<void> {
  try {
    await store.set(namespace, key, value, { ttlMs });
  } catch {
    // Best-effort - the caller's own write already succeeded; losing the
    // cache write just means the next read re-fetches from D1.
  }
}

async function safeDelete(store: KeyValueStore, namespace: string, key: string): Promise<void> {
  try {
    await store.delete(namespace, key);
  } catch {
    // Best-effort invalidation - see `safeSet`.
  }
}

function schemaCacheStoreFor(env: Record<string, unknown>): KeyValueStore | null {
  if (content.engine !== "D1" || kv.kind !== "KV") return null;
  const binding = env[kv.binding];
  if (!binding) return null;
  const existing = schemaCacheStores.get(binding as object);
  if (existing) return existing;
  const store = new KeyValueStore(createRequestKeyValueAdapter(kv, env), {
    cache: true,
    defaultTtlMs: CACHE_TTL_MS,
    maxEntries: 16,
    durability: "async",
  });
  schemaCacheStores.set(binding as object, store);
  return store;
}

/**
 * Wraps a D1 `schema` adapter so `listContentTypes()` is served from the
 * isolate-memory/KV cache above instead of a real `SELECT * FROM metadata`
 * on every call - `content-types/engine/d1.ts`'s own cache only survives one
 * request (a fresh adapter is built per request there); this one survives
 * the whole isolate. `applySave`/`deleteContentType` clear EVERY entry-data
 * cache key too (not just content-types) since a schema change can
 * retarget/rename a field on `role`/`systemSettings` themselves, which
 * those caches don't otherwise have any way to notice.
 */
export function withCachedSchema(schema: ContentEngineAdapter, store: KeyValueStore): ContentEngineAdapter {
  async function invalidateAll(): Promise<void> {
    await safeDelete(store, SCHEMA_CACHE_NAMESPACE, CONTENT_TYPES_CACHE_KEY);
    await safeDelete(store, SCHEMA_CACHE_NAMESPACE, ROLES_CACHE_KEY);
    await safeDelete(store, SCHEMA_CACHE_NAMESPACE, SYSTEM_SETTINGS_CACHE_KEY);
  }

  return {
    ...schema,
    listContentTypes: async () => {
      const cached = await safeGet<ContentTypeDefinition[]>(store, SCHEMA_CACHE_NAMESPACE, CONTENT_TYPES_CACHE_KEY);
      if (cached) return cached;
      const fresh = await schema.listContentTypes();
      await safeSet(store, SCHEMA_CACHE_NAMESPACE, CONTENT_TYPES_CACHE_KEY, fresh, CACHE_TTL_MS);
      return fresh;
    },
    applySave: async (next, plan) => {
      const saved = await schema.applySave(next, plan);
      await invalidateAll();
      return saved;
    },
    deleteContentType: async (id) => {
      await schema.deleteContentType(id);
      await invalidateAll();
    },
  };
}

/**
 * Wraps a D1 `entries` adapter so a `role` row read goes through the same
 * cache - on a miss, fetches the WHOLE role collection once (roles are few;
 * `content-types/access.ts` already documents this as cheaper than
 * per-request per-role reads) and reuses it for every role lookup until the
 * TTL/an explicit write clears it, rather than the 1+N D1 round trips
 * `resolveAccess` used to spend on every single request. Every OTHER type
 * passes straight through - this is deliberately narrow to `role`, not a
 * general entry cache, so arbitrary content (blog posts, etc.) is never
 * served stale.
 */
export function withCachedRoleReads(entries: ContentEntryEngineAdapter, store: KeyValueStore): ContentEntryEngineAdapter {
  async function loadRoles(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<EntryRow[]> {
    const cached = await safeGet<EntryRow[]>(store, SCHEMA_CACHE_NAMESPACE, ROLES_CACHE_KEY);
    if (cached) return cached;
    const page = await entries.listEntries(type, allTypes, { page: 0, pageSize: Number.MAX_SAFE_INTEGER });
    const rows = (await Promise.all(page.rows.map((row) => entries.getEntry(type, allTypes, row.id)))).filter(
      (row): row is EntryRow => row !== null,
    );
    await safeSet(store, SCHEMA_CACHE_NAMESPACE, ROLES_CACHE_KEY, rows, CACHE_TTL_MS);
    return rows;
  }

  async function invalidateIfRole(type: ContentTypeDefinition): Promise<void> {
    if (type.name === "role") await safeDelete(store, SCHEMA_CACHE_NAMESPACE, ROLES_CACHE_KEY);
  }

  return {
    ...entries,
    getEntry: async (type, allTypes, id) => {
      if (type.name !== "role") return entries.getEntry(type, allTypes, id);
      const roles = await loadRoles(type, allTypes);
      return roles.find((row) => row.id === id) ?? null;
    },
    createEntry: async (type, allTypes, value) => {
      const row = await entries.createEntry(type, allTypes, value);
      await invalidateIfRole(type);
      return row;
    },
    updateEntry: async (type, allTypes, id, value) => {
      const row = await entries.updateEntry(type, allTypes, id, value);
      await invalidateIfRole(type);
      return row;
    },
    deleteEntry: async (type, allTypes, id) => {
      await entries.deleteEntry(type, allTypes, id);
      await invalidateIfRole(type);
    },
  };
}

/**
 * Wraps a D1 `entries` adapter so the `systemSettings` singleton (the theme
 * CSS override every `.dry` page - admin AND the pre-login screens - links
 * on load, see `routes/system-settings.ts`) is served from cache instead of
 * a real `SELECT` on literally every page view. Cached as `{ row }` rather
 * than the bare row: `getSingletonEntry` legitimately returns `null` before
 * a Super Admin has ever saved a theme, and that "unset" answer needs to be
 * cacheable too - an envelope object is always truthy, so it can't be
 * confused with "not cached yet" the way a bare cached `null` would be.
 * Every other singleton passes straight through - narrow to this one type,
 * same reasoning `withCachedRoleReads` documents for `role`.
 */
export function withCachedSystemSettings(entries: ContentEntryEngineAdapter, store: KeyValueStore): ContentEntryEngineAdapter {
  return {
    ...entries,
    getSingletonEntry: async (type, allTypes) => {
      if (type.name !== "systemSettings") return entries.getSingletonEntry(type, allTypes);
      const cached = await safeGet<{ row: EntryRow | null }>(store, SCHEMA_CACHE_NAMESPACE, SYSTEM_SETTINGS_CACHE_KEY);
      if (cached) return cached.row;
      const row = await entries.getSingletonEntry(type, allTypes);
      await safeSet(store, SCHEMA_CACHE_NAMESPACE, SYSTEM_SETTINGS_CACHE_KEY, { row }, CACHE_TTL_MS);
      return row;
    },
    saveSingletonEntry: async (type, allTypes, value) => {
      const row = await entries.saveSingletonEntry(type, allTypes, value);
      if (type.name === "systemSettings") await safeDelete(store, SCHEMA_CACHE_NAMESPACE, SYSTEM_SETTINGS_CACHE_KEY);
      return row;
    },
  };
}

export function getContentAdapters(context: DryRouteContext): ContentAdapters {
  if (moduleAdapters) return moduleAdapters;
  const existing = requestAdapters.get(context);
  if (existing) return existing;
  const rawSchema = createContentEngineAdapter(content, context.env);
  const rawEntries = createContentEntryEngineAdapter(content, context.env);
  const cacheStore = schemaCacheStoreFor(context.env);
  const adapters = {
    schema: cacheStore ? withCachedSchema(rawSchema, cacheStore) : rawSchema,
    entries: cacheStore ? withCachedSystemSettings(withCachedRoleReads(rawEntries, cacheStore), cacheStore) : rawEntries,
    pagesRegistry: createPagesRegistryAdapter(content, context.env),
  };
  requestAdapters.set(context, adapters);
  return adapters;
}
