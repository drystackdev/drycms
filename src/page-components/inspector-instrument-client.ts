import type { InspectorInstrumentRequest, InspectorInstrumentResponse } from "./inspector-instrument-worker.js";

/** Generous but bounded - a single `ts.createSourceFile` pass per file is
 * normally sub-millisecond (`ts-worker.ts`'s own diagnostics run the same
 * parser plus a full type-checker well under `HANG_TIMEOUT_MS`'s 8s), so
 * this is purely a safety net against a wedged/never-loading worker, not a
 * budget this is expected to ever approach. */
const TIMEOUT_MS = 2000;

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, (files: [string, string][]) => void>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./inspector-instrument-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  worker.onmessage = (event: MessageEvent<InspectorInstrumentResponse>) => {
    const resolve = pending.get(event.data.requestId);
    pending.delete(event.data.requestId);
    resolve?.(event.data.files);
  };
  // A worker that fails to even load (e.g. blocked by a CSP) would otherwise
  // leave every pending request hanging until its own timeout - not fatal
  // (the timeout below still resolves it), but there's no reason to keep
  // trying a worker that's already dead.
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    for (const resolve of pending.values()) resolve([]);
    pending.clear();
  };
  return worker;
}

/**
 * Instruments every `.tsx` entry with `data-dry-loc` markers
 * (`inspector-instrument.ts`) off the main thread, merged back onto a copy
 * of `sourceByPath` - everything else (non-`.tsx` files) passes through
 * unchanged. Never rejects: a worker failure or timeout resolves to the
 * ORIGINAL `sourceByPath` untouched, so a build using this can't fail
 * because the (purely cosmetic, hover-sync-only) instrumentation step did -
 * the preview still renders, it just won't support hover/cursor sync for
 * that build.
 */
export function instrumentSourceLocations(sourceByPath: Record<string, string>): Promise<Record<string, string>> {
  const tsxEntries = Object.entries(sourceByPath).filter(([path]) => path.endsWith(".tsx"));
  if (tsxEntries.length === 0) return Promise.resolve(sourceByPath);
  const activeWorker = ensureWorker();
  if (!activeWorker) return Promise.resolve(sourceByPath);

  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(sourceByPath);
    }, TIMEOUT_MS);
    pending.set(requestId, (files) => {
      clearTimeout(timer);
      resolve({ ...sourceByPath, ...Object.fromEntries(files) });
    });
    const request: InspectorInstrumentRequest = { requestId, files: tsxEntries as [string, string][] };
    activeWorker.postMessage(request);
  });
}
