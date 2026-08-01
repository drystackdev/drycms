import { Readable } from "node:stream";
import { createStorageAdapter } from "../storage/index.js";
import { StorageError, type StorageAdapter, type StorageStatEntry } from "../storage/types.js";
import type { ResolvedGithubStorageOption, ResolvedGitlabStorageOption } from "../server/options.js";
import { decodeCursor, decodeValue, encodeCursor, encodeValue } from "./codec.js";
import type { KeyValueAdapter, KvBatchOperation, KvListOptions, KvListResult, KvRecord, KvRecordMeta } from "./types.js";

type GitOption = ResolvedGithubStorageOption | ResolvedGitlabStorageOption;

function part(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function bytesOf(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createGitKeyValueAdapter(option: GitOption): KeyValueAdapter {
  const storage: StorageAdapter = createStorageAdapter(option);
  const pathFor = (namespace: string, key: string) => `${part(namespace)}/${part(key)}.json`;
  async function read(namespace: string, key: string): Promise<KvRecord | null> {
    try {
      const result = await storage.read(pathFor(namespace, key));
      return JSON.parse(Buffer.from(await bytesOf(result.stream)).toString("utf8")) as KvRecord;
    } catch (error) {
      if (error instanceof StorageError && error.code === "not_found") return null;
      throw error;
    }
  }
  async function write(record: KvRecord): Promise<void> {
    await storage.write(pathFor(record.namespace, record.key), new TextEncoder().encode(JSON.stringify(record)));
  }
  return {
    get: read,
    set: write,
    async delete(namespace, key) {
      try {
        await storage.remove(pathFor(namespace, key));
      } catch (error) {
        if (!(error instanceof StorageError && error.code === "not_found")) throw error;
      }
    },
    async list(namespace, options: KvListOptions = {}): Promise<KvListResult> {
      const root = part(namespace);
      let entries: StorageStatEntry[] = [];
      try {
        entries = await storage.list(root);
      } catch (error) {
        if (!(error instanceof StorageError && error.code === "not_found")) throw error;
      }
      const search = options.search?.trim().toLowerCase() ?? "";
      const files = entries
        .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
        .filter((entry) => !search || Buffer.from(entry.name.slice(0, -5), "base64url").toString("utf8").toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name));
      const start = decodeCursor(options.cursor);
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const selected = files.slice(start, start + limit);
      const items: KvRecordMeta[] = [];
      for (const entry of selected) {
        const key = Buffer.from(entry.name.slice(0, -5), "base64url").toString("utf8");
        const record = await read(namespace, key);
        if (record) {
          const { value: _value, ...meta } = record;
          items.push({ ...meta, sizeBytes: encodeValue(record.value).sizeBytes });
        }
      }
      return { items, ...(start + limit < files.length ? { nextCursor: encodeCursor(start + limit) } : {}) };
    },
    async batch(operations: KvBatchOperation[]) {
      if (storage.writeBatch) {
        await storage.writeBatch(operations.map((operation) => ({
          path: pathFor(operation.namespace, operation.key),
          data: operation.type === "delete" ? null : new TextEncoder().encode(JSON.stringify(operation.record)),
        })), "Update Key Value records");
        return;
      }
      for (const operation of operations) {
        if (operation.type === "delete") await this.delete(operation.namespace, operation.key);
        else if (operation.record) await write(operation.record);
      }
    },
  };
}
