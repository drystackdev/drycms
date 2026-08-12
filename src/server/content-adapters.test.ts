import { describe, expect, it } from "vitest";
import { KeyValueStore } from "../kv/memory.js";
import type { KeyValueAdapter, KvRecord } from "../kv/types.js";
import { withCachedRoleReads, withCachedSchema, withCachedSystemSettings } from "./content-adapters.js";
import type { ContentEngineAdapter } from "../content-types/engine/types.js";
import type { ContentEntryEngineAdapter, EntryRow } from "../content-types/engine/entries-types.js";
import type { ContentTypeDefinition } from "../content-types/types.js";

/** Same in-process fake used by `kv/kv.test.ts` - a real `KeyValueStore` over
 * a plain `Map`, so these tests exercise the actual cache/TTL/invalidation
 * logic rather than a hand-rolled double of it. */
function memoryAdapter(): KeyValueAdapter {
  const records = new Map<string, KvRecord>();
  const id = (namespace: string, key: string) => `${namespace}\0${key}`;
  return {
    async get(namespace, key) {
      return records.get(id(namespace, key)) ?? null;
    },
    async set(record) {
      records.set(id(record.namespace, record.key), record);
    },
    async delete(namespace, key) {
      records.delete(id(namespace, key));
    },
    async list(namespace) {
      return {
        items: [...records.values()]
          .filter((record) => record.namespace === namespace)
          .map(({ value, ...record }) => ({ ...record, sizeBytes: JSON.stringify(value).length })),
      };
    },
  };
}

function fakeType(id: string): ContentTypeDefinition {
  return { id, kind: "collection", name: id, label: id, fields: [], version: 0 };
}

describe("withCachedSchema", () => {
  it("serves listContentTypes() from cache after the first call, and both applySave and deleteContentType clear it", async () => {
    const store = new KeyValueStore(memoryAdapter(), { cache: true });
    let listCalls = 0;
    const types = [fakeType("a")];
    const base: ContentEngineAdapter = {
      listContentTypes: async () => {
        listCalls++;
        return types;
      },
      getContentType: async () => null,
      planSave: async () => ({ primary: {} as never, cascaded: [] }),
      applySave: async (next) => next,
      deleteContentType: async () => {},
      getResourceVersion: async () => 0,
    };
    const cached = withCachedSchema(base, store);

    expect(await cached.listContentTypes()).toEqual(types);
    expect(await cached.listContentTypes()).toEqual(types);
    expect(listCalls).toBe(1);

    await cached.applySave(fakeType("b"), { primary: {} as never, cascaded: [] });
    await cached.listContentTypes();
    expect(listCalls).toBe(2);

    await cached.listContentTypes();
    expect(listCalls).toBe(2);

    await cached.deleteContentType("a");
    await cached.listContentTypes();
    expect(listCalls).toBe(3);
  });

  it("falls back to the real adapter (never throws) when the KV backend is unavailable on a cold miss", async () => {
    const brokenAdapter: KeyValueAdapter = {
      async get() {
        throw new Error("KV unavailable");
      },
      async set() {},
      async delete() {},
      async list() {
        return { items: [] };
      },
    };
    const store = new KeyValueStore(brokenAdapter, { cache: false });
    let listCalls = 0;
    const types = [fakeType("a")];
    const base: ContentEngineAdapter = {
      listContentTypes: async () => {
        listCalls++;
        return types;
      },
      getContentType: async () => null,
      planSave: async () => ({ primary: {} as never, cascaded: [] }),
      applySave: async (next) => next,
      deleteContentType: async () => {},
      getResourceVersion: async () => 0,
    };
    const cached = withCachedSchema(base, store);

    await expect(cached.listContentTypes()).resolves.toEqual(types);
    expect(listCalls).toBe(1);
  });
});

describe("withCachedRoleReads", () => {
  function fakeEntries(rows: EntryRow[]): { adapter: ContentEntryEngineAdapter; listCalls: number[]; getCalls: number[] } {
    const listCalls = [0];
    const getCalls = [0];
    const adapter: ContentEntryEngineAdapter = {
      listEntries: async () => {
        listCalls[0]!++;
        return { rows: rows.map((r) => ({ id: r.id, value: {} })), total: rows.length };
      },
      getEntry: async (_type, _allTypes, id) => {
        getCalls[0]!++;
        return rows.find((r) => r.id === id) ?? null;
      },
      findEntry: async () => null,
      getRawEntry: async () => null,
      createEntry: async (_type, _allTypes, value) => ({ id: 999, value }),
      updateEntry: async (_type, _allTypes, id, value) => ({ id, value }),
      deleteEntry: async () => {},
      getSingletonEntry: async () => null,
      saveSingletonEntry: async (_type, _allTypes, value) => ({ id: 1, value }),
      ensureSingletonEntry: async (_type, _allTypes) => ({ id: 1, value: {} }),
      reorderEntries: async () => {},
      getResourceVersion: async () => 0,
    };
    return { adapter, listCalls, getCalls };
  }

  it("fetches the whole role collection once on a cache miss, then serves every role by id from cache", async () => {
    const store = new KeyValueStore(memoryAdapter(), { cache: true });
    const role1: EntryRow = { id: 1, value: { permissions: ["p1"] } };
    const role2: EntryRow = { id: 2, value: { permissions: ["p2"] } };
    const { adapter, listCalls, getCalls } = fakeEntries([role1, role2]);
    const cached = withCachedRoleReads(adapter, store);
    const roleType = fakeType("role");
    const allTypes = [roleType];

    expect(await cached.getEntry(roleType, allTypes, 1)).toEqual(role1);
    expect(listCalls[0]).toBe(1);
    expect(getCalls[0]).toBe(2); // one getEntry per role while filling the cache

    expect(await cached.getEntry(roleType, allTypes, 2)).toEqual(role2);
    expect(listCalls[0]).toBe(1);
    expect(getCalls[0]).toBe(2); // no extra D1 round trip for the second role

    expect(await cached.getEntry(roleType, allTypes, 999)).toBeNull();
  });

  it("never caches a non-role type", async () => {
    const store = new KeyValueStore(memoryAdapter(), { cache: true });
    const post: EntryRow = { id: 1, value: {} };
    const { adapter, listCalls, getCalls } = fakeEntries([post]);
    const cached = withCachedRoleReads(adapter, store);
    const postType = fakeType("post");

    await cached.getEntry(postType, [postType], 1);
    await cached.getEntry(postType, [postType], 1);
    expect(listCalls[0]).toBe(0);
    expect(getCalls[0]).toBe(2); // both calls passed straight through, uncached
  });

  it("invalidates the role cache after create/update/delete on the role type", async () => {
    const store = new KeyValueStore(memoryAdapter(), { cache: true });
    const role1: EntryRow = { id: 1, value: { permissions: ["p1"] } };
    const { adapter, listCalls } = fakeEntries([role1]);
    const cached = withCachedRoleReads(adapter, store);
    const roleType = fakeType("role");
    const allTypes = [roleType];

    await cached.getEntry(roleType, allTypes, 1);
    expect(listCalls[0]).toBe(1);

    await cached.updateEntry(roleType, allTypes, 1, { permissions: ["p1", "p2"] });
    await cached.getEntry(roleType, allTypes, 1);
    expect(listCalls[0]).toBe(2);

    await cached.createEntry(roleType, allTypes, { permissions: [] });
    await cached.getEntry(roleType, allTypes, 1);
    expect(listCalls[0]).toBe(3);

    await cached.deleteEntry(roleType, allTypes, 1);
    await cached.getEntry(roleType, allTypes, 1);
    expect(listCalls[0]).toBe(4);
  });
});

describe("withCachedSystemSettings", () => {
  function fakeEntries(initial: EntryRow | null): { adapter: ContentEntryEngineAdapter; getCalls: number[] } {
    let current = initial;
    const getCalls = [0];
    const adapter: ContentEntryEngineAdapter = {
      listEntries: async () => ({ rows: [], total: 0 }),
      getEntry: async () => null,
      findEntry: async () => null,
      getRawEntry: async () => null,
      createEntry: async (_type, _allTypes, value) => ({ id: 1, value }),
      updateEntry: async (_type, _allTypes, id, value) => ({ id, value }),
      deleteEntry: async () => {},
      getSingletonEntry: async () => {
        getCalls[0]!++;
        return current;
      },
      saveSingletonEntry: async (_type, _allTypes, value) => {
        current = { id: current?.id ?? 1, value };
        return current;
      },
      ensureSingletonEntry: async (_type, _allTypes) => ({ id: 1, value: {} }),
      reorderEntries: async () => {},
      getResourceVersion: async () => 0,
    };
    return { adapter, getCalls };
  }

  it("serves getSingletonEntry from cache after the first call, and saveSingletonEntry clears it", async () => {
    const store = new KeyValueStore(memoryAdapter(), { cache: true });
    const row: EntryRow = { id: 1, value: { data: "{}" } };
    const { adapter, getCalls } = fakeEntries(row);
    const cached = withCachedSystemSettings(adapter, store);
    const type = fakeType("systemSettings");

    expect(await cached.getSingletonEntry(type, [type])).toEqual(row);
    expect(await cached.getSingletonEntry(type, [type])).toEqual(row);
    expect(getCalls[0]).toBe(1);

    await cached.saveSingletonEntry(type, [type], { data: "{}" });
    await cached.getSingletonEntry(type, [type]);
    expect(getCalls[0]).toBe(2);
  });

  it("caches a legitimate `null` (never-saved settings row) instead of re-querying every time", async () => {
    const store = new KeyValueStore(memoryAdapter(), { cache: true });
    const { adapter, getCalls } = fakeEntries(null);
    const cached = withCachedSystemSettings(adapter, store);
    const type = fakeType("systemSettings");

    expect(await cached.getSingletonEntry(type, [type])).toBeNull();
    expect(await cached.getSingletonEntry(type, [type])).toBeNull();
    expect(getCalls[0]).toBe(1);
  });

  it("never caches a different singleton type", async () => {
    const store = new KeyValueStore(memoryAdapter(), { cache: true });
    const row: EntryRow = { id: 1, value: {} };
    const { adapter, getCalls } = fakeEntries(row);
    const cached = withCachedSystemSettings(adapter, store);
    const type = fakeType("seoDefaults");

    await cached.getSingletonEntry(type, [type]);
    await cached.getSingletonEntry(type, [type]);
    expect(getCalls[0]).toBe(2);
  });
});
