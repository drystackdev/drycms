import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalKeyValueAdapter } from "./local.js";
import { createSqliteKeyValueAdapter } from "./sqlite.js";
import { KeyValueStore } from "./memory.js";
import type { KeyValueAdapter, KvRecord } from "./types.js";

const boxes: string[] = [];

afterEach(async () => {
  await Promise.all(boxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

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

describe("KeyValueStore", () => {
  it("writes through asynchronously and reads from memory immediately", async () => {
    const adapter = memoryAdapter();
    const store = new KeyValueStore(adapter, { flushDebounceMs: 60_000 });
    await store.set("content", "draft", { title: "Hello" });
    expect(await store.get("content", "draft")).toEqual({ title: "Hello" });
    expect(await adapter.get("content", "draft")).toBeNull();
    await store.flush();
    expect(await adapter.get("content", "draft")).toMatchObject({ version: 1 });
    await store.close();
  });

  it("expires values and persists the delete", async () => {
    let now = 1_000;
    const adapter = memoryAdapter();
    const store = new KeyValueStore(adapter, { now: () => now, flushDebounceMs: 60_000 });
    await store.set("content", "temporary", "value", { ttlMs: 10, durability: "sync" });
    now += 11;
    expect(await store.get("content", "temporary")).toBeNull();
    await store.flush();
    expect(await adapter.get("content", "temporary")).toBeNull();
    await store.close();
  });

  it("restores values after a new store is created", async () => {
    const adapter = memoryAdapter();
    const first = new KeyValueStore(adapter, { flushDebounceMs: 60_000 });
    await first.set("storage", "theme", "dark", { durability: "sync" });
    await first.close();
    const second = new KeyValueStore(adapter, { flushDebounceMs: 60_000 });
    expect(await second.get("storage", "theme")).toBe("dark");
    await second.close();
  });

  it("coalesces several writes to one persisted operation", async () => {
    const adapter = memoryAdapter();
    const store = new KeyValueStore(adapter, { flushDebounceMs: 60_000 });
    await store.set("content", "counter", 1);
    await store.set("content", "counter", 2);
    await store.flush();
    expect(await store.get("content", "counter")).toBe(2);
    expect((await adapter.get("content", "counter"))?.version).toBe(2);
    await store.close();
  });
});

describe("local KeyValueAdapter", () => {
  it("round-trips records and lists metadata without values", async () => {
    const root = await mkdtemp(join(tmpdir(), "drycms-kv-"));
    boxes.push(root);
    const adapter = createLocalKeyValueAdapter(root);
    const record: KvRecord = {
      namespace: "content",
      key: "hello/world",
      value: { ok: true },
      version: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    await adapter.set(record);
    expect(await adapter.get("content", "hello/world")).toEqual(record);
    expect((await adapter.list("content")).items).toEqual([
      expect.objectContaining({ namespace: "content", key: "hello/world", sizeBytes: 11 }),
    ]);
    expect(await readFile(join(root, "Y29udGVudA", "aGVsbG8vd29ybGQ.json"), "utf8")).toContain("hello/world");
  });
});

describe("SQLite atomic counters", () => {
  it("increments within a window and resets after it expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "drycms-kv-sqlite-"));
    boxes.push(root);
    const adapter = createSqliteKeyValueAdapter(join(root, "security.sqlite"));
    expect(adapter.increment).toBeDefined();
    expect(await adapter.increment!("auth-rate-limit", "email-test", 1_000, 5_000)).toMatchObject({ count: 1 });
    expect(await adapter.increment!("auth-rate-limit", "email-test", 1_000, 5_000)).toMatchObject({ count: 2 });
    await adapter.deleteCounter!("auth-rate-limit", "email-test");
    expect(await adapter.increment!("auth-rate-limit", "email-test", 1_000, 5_000)).toMatchObject({ count: 1 });
  });
});
