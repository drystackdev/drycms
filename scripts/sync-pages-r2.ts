/**
 * Mirrors `src/apps/pages/**` <-> the `pagesSource` storage root
 * (`.dry/pages-source` locally, R2 under `kind: "cloudflare"`) -
 * `pagesSourceStorage` is now the live source `discoverRoutes()` reads from
 * in dev (`route-tree.ts`), and `src/apps/pages` is a gitignored, build-time
 * artifact `push`/`pull` materializes right before `vite build` (`build`/
 * `build:worker` in `package.json`). Same unconditional-overwrite semantics
 * as `r2-sync-assets.ts` (which just `wrangler r2 object put`s every local
 * file, no existence check) - `push`/`pull` here ALWAYS overwrite whatever's
 * already at the destination. Neither direction deletes a file that's
 * missing from the SOURCE but still present at the destination (same
 * "additive, not a full mirror" precedent `r2-sync-assets.ts` sets - nothing
 * here walks the destination looking for extras to remove).
 *
 * Run with:
 *   bun run pages:sync --push            # git -> storage, local kind
 *   bun run pages:sync --push --remote   # git -> storage, real R2 bucket
 *   bun run pages:sync --push --local    # git -> storage, miniflare local R2
 *   bun run pages:sync --pull [--remote|--local]   # storage -> git
 *
 * `build` (the local/Node target) also calls `pull` directly (not through
 * the CLI) to materialize `src/apps/pages` from the current live source
 * before Vite's compile-time glob (`discoverRoutes()`'s prod branch) runs.
 * `build:worker`/`deploy` do NOT.
 *
 * `--local` (miniflare-simulated R2, `wrangler dev`/`dev:worker`'s own
 * storage) delegates to `r2-local-bucket.mjs`, a plain-`node` subprocess
 * that talks to the real `MEDIA_BUCKET` binding via `getPlatformProxy`
 * (`wrangler`'s own public API for getting real binding objects outside a
 * running Worker) - see that file's own doc comment for why this can't just
 * call `getPlatformProxy` inline from here: it does not work under `bun`
 * (confirmed live, 2026-08-09 - either throws `DataCloneError` or hangs
 * indefinitely depending on which binding is touched first), and this
 * script otherwise runs entirely under `bun`, same as every other file
 * under `scripts/`. `getPlatformProxy`'s default `persist` location is the
 * SAME `.wrangler/state/v3` a real `wrangler dev` session reads/writes, so
 * this sees exactly what a page saved through `/api/pages-source` while
 * `dev:worker` was running actually wrote. Found live (2026-08-09): the
 * previous approach (`wrangler r2 object list`) does not exist in the
 * installed `wrangler` at all (only `get`/`put`/`delete` do - confirmed via
 * `wrangler r2 object --help`), for `--local` OR `--remote` - `pull`'s R2
 * branch always failed before this.
 *
 * `--remote` (the real bucket) is UNCHANGED and still uses `wrangler r2
 * object put/get` subprocesses (`push` works fine this way; `pull` still
 * can't list). Deliberately NOT switched to `getPlatformProxy` too -
 * `remoteBindings` only actually reaches the real bucket if the binding
 * itself is marked `remote: true` in `wrangler.jsonc`, which it currently
 * isn't (and flipping that on would ALSO make every plain `wrangler dev`/
 * `dev:worker` run - no `--remote` flag needed - silently start reading/
 * writing the REAL production bucket instead of local state, a much bigger
 * behavior change than this script should make on its own). Keep R2 in sync
 * for a real deploy by hand: `bun run pages:sync --push --remote` after any
 * `src/apps/pages` edit that should reach production.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveOptions } from "../src/server/options.js";

const args = process.argv.slice(2);
// 3-way, not a boolean: no flag = target the plain local-disk root (`kind:
// "local"` deployments never touch R2 at all); `--remote`/`--local` both
// target R2 (real vs. miniflare), same distinction `r2-sync-assets.ts`'s
// own `--local` flag makes. Read from `process.argv` unconditionally (not
// just inside the CLI guard at the bottom) so `push`/`pull` below close over
// the right target REGARDLESS of caller - both the CLI entry point and
// `dev-server.mjs`'s own auto-sync-on-startup hook (`plans/app-r2.md`,
// "pull/push tự động ở dev") import this same module and expect `push`/
// `pull` to behave like a plain `bun run pages:sync --push` with no extra
// flags would: the dev server's own `process.argv` never has `--remote`/
// `--local` either, so this already resolves to the right (local-disk)
// target for that caller with no separate code path needed.
const targetsR2 = args.includes("--remote") || args.includes("--local");
const useLocalR2 = args.includes("--local");

const GIT_PAGES_ROOT = new URL("../src/apps/pages/", import.meta.url).pathname.replace(/\/$/, "");
const localRoots = resolveOptions({ kind: "local" });
const r2Roots = resolveOptions({ kind: "cloudflare" });
const storageRoot = localRoots.pagesSource.storage;
const r2Prefix = r2Roots.pagesSource.storage.kind === "r2" ? r2Roots.pagesSource.storage.prefix : "";
const isR2 = targetsR2;

/** `wrangler.jsonc` is the single source of truth for the bucket name - same
 * parsing `r2-sync-assets.ts` already does (stripping `//` comments rather
 * than adding a JSONC dependency for one field). Only actually called for
 * the `--remote` (real bucket, `wrangler` CLI subprocess) path below - the
 * `--local` path resolves the SAME binding through `getPlatformProxy`
 * instead, which needs no bucket name at all. */
async function bucketName(): Promise<string> {
  const raw = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(stripped) as { r2_buckets?: { binding: string; bucket_name: string }[] };
  const bucket = config.r2_buckets?.find((entry) => entry.binding === "MEDIA_BUCKET");
  if (!bucket) throw new Error('[drycms] wrangler.jsonc has no r2_buckets entry bound as "MEDIA_BUCKET".');
  return bucket.bucket_name;
}

const R2_LOCAL_BUCKET_HELPER = new URL("./r2-local-bucket.mjs", import.meta.url).pathname;

/** Spawns `r2-local-bucket.mjs` under plain `node` (see this file's own doc
 * comment for why) and inherits its stdio directly - that helper already
 * prints the same per-file/summary log lines this script's own local-disk
 * and `--remote` branches print, so the caller doesn't repeat them. */
function runLocalR2Helper(mode: "pull" | "push", rootDir: string): void {
  const proc = Bun.spawnSync(["node", R2_LOCAL_BUCKET_HELPER, mode, r2Prefix, rootDir], { stdio: ["inherit", "inherit", "inherit"] });
  if (proc.exitCode !== 0) {
    console.error(`[drycms] local R2 ${mode} failed (see output above).`);
    process.exit(1);
  }
}

async function filesUnder(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile() && entry.name !== ".dir") found.push(full);
  }
  return found;
}

export async function push(): Promise<void> {
  const files = await filesUnder(GIT_PAGES_ROOT);
  if (files.length === 0) {
    console.log(`[drycms] "${GIT_PAGES_ROOT}" is empty - nothing to push.`);
    return;
  }
  if (isR2 && useLocalR2) {
    runLocalR2Helper("push", GIT_PAGES_ROOT);
    return;
  }
  let written = 0;
  if (isR2) {
    const bucket = await bucketName();
    for (const file of files) {
      const relPath = relative(GIT_PAGES_ROOT, file).split("\\").join("/");
      const key = r2Prefix ? `${r2Prefix}/${relPath}` : relPath;
      const proc = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote"]);
      if (proc.exitCode !== 0) {
        console.error(`[drycms] failed to push ${key}:\n${new TextDecoder().decode(proc.stderr)}`);
        process.exit(1);
      }
      console.log(`  push ${key}`);
      written += 1;
    }
  } else {
    for (const file of files) {
      const relPath = relative(GIT_PAGES_ROOT, file).split("\\").join("/");
      const destPath = join(storageRoot.kind === "local" ? storageRoot.root : "", relPath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await readFile(file));
      console.log(`  push ${relPath}`);
      written += 1;
    }
  }
  console.log(`[drycms] pushed ${written} file(s) (destination overwritten if already present).`);
}

export async function pull(): Promise<void> {
  if (isR2 && useLocalR2) {
    runLocalR2Helper("pull", GIT_PAGES_ROOT);
    return;
  }
  let written = 0;
  if (isR2) {
    const bucket = await bucketName();
    console.error(
      `[drycms] "wrangler r2 object list" does not exist (checked live, "wrangler r2 object --help") - listing "${bucket}/${r2Prefix}" over the real bucket isn't supported yet. ` +
        `Use "bun run pages:sync --push --remote" to push local edits to the real bucket by hand instead, or "--local" to pull from wrangler dev's own simulated storage.`,
    );
    process.exit(1);
  } else {
    if (storageRoot.kind !== "local") throw new Error("[drycms] unreachable - resolveOptions({kind:'local'}) always gives a local root.");
    const files = await filesUnder(storageRoot.root);
    for (const file of files) {
      const relPath = relative(storageRoot.root, file).split("\\").join("/");
      const destPath = join(GIT_PAGES_ROOT, relPath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await readFile(file));
      console.log(`  pull ${relPath}`);
      written += 1;
    }
  }
  console.log(`[drycms] pulled ${written} file(s) (destination overwritten if already present).`);
}

/**
 * CLI entry point - only when this file is run directly (`bun run
 * pages:sync`/`bun scripts/sync-pages-r2.ts`), never when `push`/`pull` are
 * imported instead (`dev-server.mjs`'s auto-sync-on-startup hook). Guards
 * the `--push`/`--pull` requirement here specifically: an IMPORTING caller
 * has no reason to pass either flag (it calls the function it wants
 * directly), so that validation would incorrectly reject a normal import.
 */
if (import.meta.main) {
  const mode = args.includes("--push") ? "push" : args.includes("--pull") ? "pull" : null;
  if (!mode) {
    console.error(
      "[drycms] usage: bun run pages:sync --push|--pull [--remote|--local]\n" +
        "  (no flag = plain local disk root, kind \"local\" deployments;\n" +
        "   --remote = real R2 bucket; --local = miniflare local R2, for wrangler dev)",
    );
    process.exit(1);
  }
  if (mode === "push") await push();
  else await pull();
}
