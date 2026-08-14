import type { DryRouteContext } from "./context.js";
import { pagesSourceStorage } from "./config.js";
import { getStorageAdapter } from "./storage-adapters.js";
import { base64Decode } from "../lib/secret-crypto.js";
import { parseZip } from "../storage/zip.js";
import { PAGES_SOURCE_SEED_ZIP_BASE64 } from "./generated-pages-source-seed.js";

/**
 * Seeds a fresh tenant's R2 `pagesSourceStorage` from `PAGES_SOURCE_SEED_ZIP_
 * BASE64` (`generated-pages-source-seed.ts`, baked at build time from
 * whatever's currently in `src/apps/{pages,component,styles,md}` - see that
 * generator's own doc comment) - replaces what's documented (`AGENTS.md`) as
 * a manual `bun run pages:sync --push --remote` step after a fresh deploy.
 * `page-handler.ts` calls this once per request, right after the call that
 * already triggers `content-types/engine/d1.ts`'s own `ensureBootstrap` as a
 * side effect - same request, effectively the same "first time this tenant's
 * D1 gets initialized" moment, without `d1.ts` itself taking on a storage/
 * zip dependency.
 *
 * A no-op for `kind: "local"` (dev/Node - `pagesSourceStorage` is always
 * real local disk already, nothing to seed) and for an empty generated
 * constant (a checkout that never ran `bun run build:worker`).
 */
const seededBindings = new WeakSet<object>();

const SEED_MARKER_PATH = ".seeded";

export async function ensurePagesSourceSeeded(context: DryRouteContext): Promise<void> {
  if (pagesSourceStorage.kind !== "r2" || !PAGES_SOURCE_SEED_ZIP_BASE64) return;
  const binding = context.env[pagesSourceStorage.binding] as object | undefined;
  if (!binding) return;
  // Per-isolate fast path only - NOT the real idempotency check. A cold
  // isolate always falls through to the `.seeded` object check below, which
  // is what actually prevents re-seeding over a tenant's later real edits
  // (this WeakSet resets on every isolate recycle; that's fine, it only
  // exists to skip a redundant `stat()` on a warm isolate's 2nd+ request).
  if (seededBindings.has(binding)) return;

  const storage = getStorageAdapter(pagesSourceStorage, context);
  const marker = await storage.stat(SEED_MARKER_PATH);
  if (marker) {
    seededBindings.add(binding);
    return;
  }

  const entries = parseZip(base64Decode(PAGES_SOURCE_SEED_ZIP_BASE64));
  for (const entry of entries) {
    await storage.write(entry.path, entry.data);
  }
  // Written LAST, deliberately: a request that dies mid-loop leaves no
  // marker, so the NEXT request just retries the same (idempotent) writes
  // instead of being permanently skipped half-seeded.
  await storage.write(SEED_MARKER_PATH, new Uint8Array(0));
  seededBindings.add(binding);
}
