import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeCursor, encodeCursor, encodeValue } from "./codec.js";
import type { KeyValueAdapter, KvBatchOperation, KvListOptions, KvListResult, KvRecord, KvRecordMeta } from "./types.js";

function encodePart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function createLocalKeyValueAdapter(root: string): KeyValueAdapter {
  function namespaceDir(namespace: string): string {
    return join(root, encodePart(namespace));
  }
  function recordPath(namespace: string, key: string): string {
    return join(namespaceDir(namespace), `${encodePart(key)}.json`);
  }
  async function readRecord(namespace: string, key: string): Promise<KvRecord | null> {
    try {
      return JSON.parse(await readFile(recordPath(namespace, key), "utf8")) as KvRecord;
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  async function writeRecord(record: KvRecord): Promise<void> {
    await mkdir(namespaceDir(record.namespace), { recursive: true });
    const path = recordPath(record.namespace, record.key);
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(record), "utf8");
    await rename(temp, path);
  }
  return {
    get: readRecord,
    set: writeRecord,
    async delete(namespace, key) {
      try {
        await rm(recordPath(namespace, key));
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
    },
    async list(namespace, options: KvListOptions = {}): Promise<KvListResult> {
      const names = (await readdir(namespaceDir(namespace)).catch((error: any) => error?.code === "ENOENT" ? [] : Promise.reject(error)))
        .filter((name) => name.endsWith(".json"))
        .sort();
      const start = decodeCursor(options.cursor);
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const selected = names.slice(start, start + limit);
      const items: KvRecordMeta[] = [];
      for (const name of selected) {
        const record = await readRecord(namespace, decodePart(name.slice(0, -5)));
        if (!record) continue;
        items.push({
          namespace: record.namespace,
          key: record.key,
          version: record.version,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
          sizeBytes: encodeValue(record.value).sizeBytes,
        });
      }
      return { items, ...(start + limit < names.length ? { nextCursor: encodeCursor(start + limit) } : {}) };
    },
    async batch(operations: KvBatchOperation[]) {
      for (const operation of operations) {
        if (operation.type === "set" && operation.record) await writeRecord(operation.record);
        else await this.delete(operation.namespace, operation.key);
      }
    },
  };
}
