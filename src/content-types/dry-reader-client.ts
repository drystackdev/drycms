import type { DryCallLogEntry } from "./dry-context.js";
import type { DryCollectionReader, DryReader, DrySingletonReader } from "./dry-reader.js";

/**
 * Client-side `dry()` for hydration (`plans/app-router.md`'s Giai đoạn 2) -
 * `app-router-plugin.ts` injects THIS import (instead of `dry-reader.js`'s
 * real, DB-backed one) into the client build of `src/apps/pages/**`. No
 * `AsyncLocalStorage` needed here (unlike `dry-context.ts`'s server
 * version) - a browser page only ever has 1 hydration pass in flight at a
 * time, so a plain module-level variable is enough.
 *
 * Replay is purely POSITIONAL: `hydrate-client.ts` re-runs the exact same
 * `page.tsx`/`layout.tsx` code path that produced the log server-side, in
 * the same order, so "the next entry" is always the right one - no need to
 * match by `kind`/`name`/`method`. Those fields exist only so a mismatch
 * (a real bug - client and server code diverged) can be logged instead of
 * silently returning wrong data.
 */
let log: DryCallLogEntry[] = [];
let index = 0;

export function setReplayLog(entries: DryCallLogEntry[]): void {
  log = entries;
  index = 0;
}

function next(kind: DryCallLogEntry["kind"], name: string, method: DryCallLogEntry["method"]): unknown {
  const entry = log[index++];
  if (!entry) {
    console.warn(`[drycms] dry().${kind}("${name}").${method}() - replay log ran out of entries.`);
    return method === "list" ? { rows: [], total: 0 } : null;
  }
  if (entry.kind !== kind || entry.name !== name || entry.method !== method) {
    console.warn(
      `[drycms] dry() replay mismatch at position ${index - 1}: expected ${entry.kind}.${entry.name}.${entry.method}, got ${kind}.${name}.${method}.`,
    );
  }
  return entry.result;
}

/** `options` (a `populate` list) is accepted but ignored - the server
 * already ran `populateRelations` before recording the result into
 * `callLog`, so a replayed row comes back pre-populated for free. */
function createCollectionReader(name: string): DryCollectionReader<Record<string, unknown>> {
  return {
    async get(_idOrSlug: number | string, _options?: { populate?: string[] }) {
      return next("collection", name, "get") as Record<string, unknown> | null;
    },
    async list() {
      return next("collection", name, "list") as { rows: Record<string, unknown>[]; total: number };
    },
  } as DryCollectionReader<Record<string, unknown>>;
}

function createSingletonReader(name: string): DrySingletonReader<Record<string, unknown>> {
  return {
    async get(_options?: { populate?: string[] }) {
      return next("singleton", name, "get") as Record<string, unknown> | null;
    },
  } as DrySingletonReader<Record<string, unknown>>;
}

export function dry(): DryReader {
  return {
    collection: (name) => createCollectionReader(name),
    singleton: (name) => createSingletonReader(name),
  };
}
