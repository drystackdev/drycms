/**
 * `dev:worker`'s process wrapper - runs `wrangler dev` as a child process
 * and, alongside it, watches wrangler's own local-R2 persisted state
 * (`.wrangler/state/v3/r2`, the same directory `getPlatformProxy`/
 * `r2-local-bucket.mjs` reads and writes - see `sync-pages-r2.ts`'s doc
 * comment) for changes, so a page saved through the Page Editor/VEI while
 * `dev:worker` is running gets picked up automatically instead of staying
 * frozen at whatever `src/apps/pages` looked like when the session started
 * (`route-tree.ts`'s `discoverRoutes()` only has a live-read branch for
 * `bun run dev`'s Vite middleware mode - a built Worker can't dynamically
 * import arbitrary new `.tsx` source at runtime, so re-materializing +
 * rebuilding is the only way to catch up).
 *
 * On a change, re-runs `sync-pages-r2.ts --pull --local` (storage -> `src/
 * apps/pages`) then `build:worker` (recompiles `dist/server/entry-worker.js`)
 * - `wrangler dev` already watches its own built entry file and reloads the
 * Worker isolate on change, so no extra signal back to it is needed. Not
 * scoped to just the pages-source key prefix (miniflare's on-disk object
 * keys are content-hashed, not human paths) - any write through the shared
 * `MEDIA_BUCKET` binding (e.g. a Media Manager upload) also triggers a
 * rebuild. Harmless, just an extra few seconds - debounced so one batch of
 * writes (a single save) only triggers one rebuild.
 *
 * Filtered to paths containing `/blobs/` (where miniflare's R2 sim actually
 * stores object bytes, under `<bucket>/blobs/<content-hash>` - confirmed live)
 * and explicitly excluding `miniflare-R2BucketObject` (its metadata SQLite
 * db). Found live: without this filter, the `pull` step's OWN reads (plain
 * `bucket.get`/`list` via `getPlatformProxy`) touch that metadata db's
 * `-wal`/`-shm` files even for a read-only access, which fs.watch reports as
 * a change - triggering another pull, which touches them again, forever.
 * Real object writes always create/touch a `blobs/` file (content-addressed,
 * so a genuinely new save is a new filename), which reads never do - that
 * asymmetry is what breaks the loop.
 *
 * `{ recursive: true }` on `fs.watch` only works on macOS/Windows, not
 * Linux (same platform caveat `dev-server.mjs`'s `closeExistingDevServer`
 * already documents for `pgrep`) - an unsupported platform just never
 * triggers a rebuild, same as before this script existed.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join } from "node:path";

const R2_STATE_DIR = join(process.cwd(), ".wrangler/state/v3/r2");
const DEBOUNCE_MS = 800;

function isRealObjectWrite(filename) {
  if (!filename) return false;
  const normalized = filename.split("\\").join("/");
  return normalized.includes("/blobs/") && !normalized.includes("miniflare-R2BucketObject");
}

function rebuild() {
  console.log("[drycms] local R2 state changed - re-pulling pages-source and rebuilding the worker...");
  const pull = spawnSync("bun", ["scripts/sync-pages-r2.ts", "--pull", "--local"], { stdio: "inherit" });
  if (pull.status !== 0) {
    console.error("[drycms] pull failed - skipping rebuild, wrangler dev keeps serving the previous build.");
    return;
  }
  const build = spawnSync("bun", ["run", "build:worker"], { stdio: "inherit" });
  if (build.status !== 0) {
    console.error("[drycms] build:worker failed - wrangler dev keeps serving the previous build.");
    return;
  }
  console.log("[drycms] rebuilt - wrangler dev will reload shortly.");
}

let debounceTimer;
function scheduleRebuild() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(rebuild, DEBOUNCE_MS);
}

function attachWatcherWhenReady() {
  if (!existsSync(R2_STATE_DIR)) {
    setTimeout(attachWatcherWhenReady, 500);
    return;
  }
  watch(R2_STATE_DIR, { recursive: true }, (_eventType, filename) => {
    if (isRealObjectWrite(filename)) scheduleRebuild();
  });
  console.log(`[drycms] watching ${R2_STATE_DIR} for page-source saves (Page Editor/VEI).`);
}
attachWatcherWhenReady();

const wrangler = spawn("wrangler", ["dev"], { stdio: "inherit" });
wrangler.on("exit", (code, signal) => {
  clearTimeout(debounceTimer);
  process.exit(code ?? (signal ? 1 : 0));
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => wrangler.kill(signal));
}
