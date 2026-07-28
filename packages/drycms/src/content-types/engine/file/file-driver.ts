import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import type { ResolvedFileContentOption } from "../../../integration/options.js";
import { randomUUID } from "../../../lib/uuid.js";
import { createStorageAdapter, StorageError, type StorageAdapter } from "../../../storage/index.js";
import { resolveWithinRoot } from "../../../storage/path.js";

/** Rejects anything that isn't a single, literal path segment - guards
 * against a `type.name`/`FieldDefinition.id` (unlike a field's `name`,
 * `naming.ts` never restricts an `id`'s charset) being used to build a
 * filesystem/repo path down in `index-store.ts`/`entries-file.ts`. SQL never
 * has this problem (an identifier is always routed through `quoteIdent`, not
 * concatenated into a path), so this file engine needs its own guard. */
export function safePathSegment(raw: string): string {
  if (!raw || raw.includes("/") || raw.includes("\\") || raw === "." || raw === "..") {
    throw new Error(`[drycms] "${raw}" is not a safe path segment.`);
  }
  return raw;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Thin JSON-object read/write/list layer over `StorageAdapter` (the same
 * local/github/gitlab backend Media/Icon storage already uses), plus what
 * `StorageAdapter` itself doesn't provide: an atomic single-file write for
 * `local` (write-temp-then-rename, so a crash mid-write can never leave a
 * half-written record on disk) and an in-process async mutex so concurrent
 * requests never interleave a read-modify-write on the same file. For
 * `github`/`gitlab`, "atomic" just means "one `write()` call is one commit" -
 * already true of `StorageAdapter.write()`, no temp-file trick applies over
 * HTTP.
 */
export interface FileDriver {
  /** `null` if the path doesn't exist. */
  readJson<T = unknown>(relPath: string): Promise<T | null>;
  writeJson(relPath: string, value: unknown): Promise<void>;
  /** No-op (not an error) if the path doesn't already exist. */
  removeJson(relPath: string): Promise<void>;
  /** Recursive; no-op if the folder doesn't already exist. */
  removeDir(relPath: string): Promise<void>;
  /** Base names (without the `.json` extension) of every `.json` file
   * directly inside `dirRelPath`, sorted. `[]` if the folder doesn't exist
   * yet (a collection with no entries yet has no `data/<type>/` folder). */
  listJsonFiles(dirRelPath: string): Promise<string[]>;
  /** Serializes every call sharing the same `key` into a single queue -
   * callers use this around read-modify-write critical sections (id
   * counters, unique-value indexes, relation reverse-indexes). Only
   * serializes writes made by THIS Node process - see `status/
   * file-database-engine.md`'s plan doc and this module's own doc comment
   * for why that's an accepted, documented limitation rather than a bug. */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export function createFileDriver(option: ResolvedFileContentOption): FileDriver {
  const adapter: StorageAdapter = createStorageAdapter(option);
  const locks = new Map<string, Promise<unknown>>();

  async function readJson<T = unknown>(relPath: string): Promise<T | null> {
    let result;
    try {
      result = await adapter.read(relPath);
    } catch (error) {
      if (error instanceof StorageError && error.code === "not_found") return null;
      throw error;
    }
    const buf = await streamToBuffer(result.stream);
    if (buf.length === 0) return null;
    return JSON.parse(buf.toString("utf8")) as T;
  }

  async function writeJsonViaAdapter(relPath: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value, null, 2);
    await adapter.write(relPath, Buffer.from(json, "utf8"));
  }

  async function writeJsonLocalAtomic(relPath: string, value: unknown): Promise<void> {
    const absPath = resolveWithinRoot(option.root, relPath);
    await fs.mkdir(dirname(absPath), { recursive: true });
    const tmpPath = `${absPath}.tmp-${randomUUID()}`;
    const json = JSON.stringify(value, null, 2);
    await fs.writeFile(tmpPath, json, "utf8");
    await fs.rename(tmpPath, absPath);
  }

  async function writeJson(relPath: string, value: unknown): Promise<void> {
    if (option.kind === "local") {
      await writeJsonLocalAtomic(relPath, value);
    } else {
      await writeJsonViaAdapter(relPath, value);
    }
  }

  async function removeJson(relPath: string): Promise<void> {
    try {
      await adapter.remove(relPath);
    } catch (error) {
      if (error instanceof StorageError && error.code === "not_found") return;
      throw error;
    }
  }

  async function removeDir(relPath: string): Promise<void> {
    await removeJson(relPath);
  }

  async function listJsonFiles(dirRelPath: string): Promise<string[]> {
    let entries;
    try {
      entries = await adapter.list(dirRelPath);
    } catch (error) {
      if (error instanceof StorageError && (error.code === "not_found" || error.code === "invalid_path")) return [];
      throw error;
    }
    return entries
      .filter((e) => e.kind === "file" && e.name.endsWith(".json"))
      .map((e) => e.name.slice(0, -".json".length))
      .sort();
  }

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = locks.get(key) ?? Promise.resolve();
    const run = tail.then(fn, fn);
    locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  return { readJson, writeJson, removeJson, removeDir, listJsonFiles, withLock };
}
