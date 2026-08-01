import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import type { ResolvedFileContentOption } from "../../../server/options.js";
import { randomUUID } from "../../../lib/uuid.js";
import { createStorageAdapter, StorageError, type StorageAdapter } from "../../../storage/index.js";
import { resolveWithinRoot } from "../../../storage/path.js";
import { commitMessage } from "../../../storage/util.js";

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
 * local backend Media/Icon storage already uses), plus what
 * `StorageAdapter` itself doesn't provide: an atomic single-file write for
 * `local` (write-temp-then-rename, so a crash mid-write can never leave a
 * half-written record on disk) and an in-process async mutex so concurrent
 * requests never interleave a read-modify-write on the same file.
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
  /** Runs `fn` against a driver that stages every `writeJson`/`removeJson`/
   * `removeDir` in memory instead of touching the backend immediately, then
   * flushes them as ONE `StorageAdapter.writeBatch()` call once `fn` resolves
   * - nothing lands if `fn` throws.
   * `readJson`/`listJsonFiles` on the staged driver see the staged writes
   * ("read your own writes") before falling back to the real backend for
   * paths this transaction hasn't touched. Calling `.transaction()` again on
   * an already-staged driver (nested calls, e.g. a helper that itself opens
   * a transaction, invoked from inside one already open) just joins the
   * existing one - no extra commit, nothing flushes until the OUTERMOST
   * transaction resolves. `local` has no commit concept, so its flush just
   * replays the staged writes through the same atomic per-file write this
   * driver already does outside a transaction. */
  transaction<T>(fn: (tx: FileDriver) => Promise<T>): Promise<T>;
}

type StagedOp =
  | { kind: "write"; path: string; value: unknown }
  | { kind: "remove"; path: string }
  | { kind: "removeDir"; prefix: string };

function isUnderDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** `null` if `path` isn't a direct `.json` child of `dir` (a deeper nested
 * path, or outside `dir` entirely). */
function jsonBaseNameIn(path: string, dir: string): string | null {
  if (!path.startsWith(`${dir}/`)) return null;
  const rest = path.slice(dir.length + 1);
  if (rest.includes("/") || !rest.endsWith(".json")) return null;
  return rest.slice(0, -".json".length);
}

/** Wraps `real` with an in-memory op log staging every mutation - `readJson`/
 * `listJsonFiles` replay the log (most recent op affecting a path wins)
 * before falling back to `real`. Shares `real`'s lock map via `withLock`
 * (delegates outright) so cross-request serialization on id counters/unique
 * indexes/reverse indexes still holds inside a transaction. */
function createStagingDriver(real: FileDriver, log: StagedOp[]): FileDriver {
  async function readJson<T = unknown>(relPath: string): Promise<T | null> {
    for (let i = log.length - 1; i >= 0; i--) {
      const op = log[i]!;
      if (op.kind === "write" && op.path === relPath) return structuredClone(op.value) as T;
      if (op.kind === "remove" && op.path === relPath) return null;
      if (op.kind === "removeDir" && isUnderDir(relPath, op.prefix)) return null;
    }
    return real.readJson<T>(relPath);
  }

  async function writeJson(relPath: string, value: unknown): Promise<void> {
    log.push({ kind: "write", path: relPath, value: structuredClone(value) });
  }

  async function removeJson(relPath: string): Promise<void> {
    log.push({ kind: "remove", path: relPath });
  }

  async function removeDir(relPath: string): Promise<void> {
    log.push({ kind: "removeDir", prefix: relPath });
  }

  async function listJsonFiles(dirRelPath: string): Promise<string[]> {
    let names: Set<string> | undefined;
    let startIndex = 0;
    for (let i = log.length - 1; i >= 0; i--) {
      const op = log[i]!;
      if (op.kind === "removeDir" && isUnderDir(dirRelPath, op.prefix)) {
        names = new Set();
        startIndex = i + 1;
        break;
      }
    }
    names ??= new Set(await real.listJsonFiles(dirRelPath));
    for (let i = startIndex; i < log.length; i++) {
      const op = log[i]!;
      if (op.kind === "write") {
        const base = jsonBaseNameIn(op.path, dirRelPath);
        if (base) names.add(base);
      } else if (op.kind === "remove") {
        const base = jsonBaseNameIn(op.path, dirRelPath);
        if (base) names.delete(base);
      }
    }
    return [...names].sort();
  }

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return real.withLock(key, fn);
  }

  function transaction<T>(fn: (tx: FileDriver) => Promise<T>): Promise<T> {
    return fn(staging);
  }

  const staging: FileDriver = { readJson, writeJson, removeJson, removeDir, listJsonFiles, withLock, transaction };
  return staging;
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
      // `listNames` is `list()` minus the per-entry `modifiedAt` lookup -
      // dropped here anyway since only `.name` is ever used below.
      entries = adapter.listNames ? await adapter.listNames(dirRelPath) : await adapter.list(dirRelPath);
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

  /** Replays a resolved op log into final per-path state - a `removeDir` is
   * expanded, at the point it occurs, into explicit removes of every path
   * known under its prefix so far (real files, via `listJsonFiles`, plus
   * anything this same log already staged there); ops after it can freely
   * re-add a path underneath. `listJsonFiles` only enumerates one directory
   * level, matching every `removeDir` call site in this engine (always a
   * flat `data/<type>/` collection folder, never a deeper tree). */
  async function resolveFinalState(log: StagedOp[]): Promise<Map<string, { op: "write"; value: unknown } | { op: "remove" }>> {
    const state = new Map<string, { op: "write"; value: unknown } | { op: "remove" }>();
    for (const op of log) {
      if (op.kind === "write") {
        state.set(op.path, { op: "write", value: op.value });
      } else if (op.kind === "remove") {
        state.set(op.path, { op: "remove" });
      } else {
        const realNames = await listJsonFiles(op.prefix);
        for (const name of realNames) state.set(`${op.prefix}/${name}.json`, { op: "remove" });
        for (const [path] of state) {
          if (isUnderDir(path, op.prefix)) state.set(path, { op: "remove" });
        }
      }
    }
    return state;
  }

  async function transaction<T>(fn: (tx: FileDriver) => Promise<T>): Promise<T> {
    const log: StagedOp[] = [];
    const staging = createStagingDriver(driver, log);
    const result = await fn(staging);
    if (log.length === 0) return result;

    const finalState = await resolveFinalState(log);
    if (adapter.writeBatch) {
      const paths = [...finalState.keys()];
      const ops = paths.map((path) => {
        const entry = finalState.get(path)!;
        return { path, data: entry.op === "remove" ? null : Buffer.from(JSON.stringify(entry.value, null, 2), "utf8") };
      });
      await adapter.writeBatch(ops, commitMessage("save", paths.length === 1 ? paths[0]! : `${paths.length} files`));
    } else {
      for (const [path, entry] of finalState) {
        if (entry.op === "write") await writeJson(path, entry.value);
        else await removeJson(path);
      }
    }
    return result;
  }

  const driver: FileDriver = { readJson, writeJson, removeJson, removeDir, listJsonFiles, withLock, transaction };
  return driver;
}
