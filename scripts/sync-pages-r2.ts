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
 * `build:worker`/`deploy` do NOT - `pull`'s R2 branch shells out to
 * `wrangler r2 object list`, which does not exist in the currently
 * installed `wrangler` (only `get`/`put`/`delete` do; confirmed live,
 * `wrangler r2 object --help`) - so it always fails. Until that's fixed
 * (a real Cloudflare-API/S3-compatible listing call, not a `wrangler`
 * subcommand swap), keep R2 in sync by hand before deploying:
 * `bun run pages:sync --push --remote` after any `src/apps/pages` edit
 * that should reach production.
 *
 * Same "shell out to `wrangler r2 object put/get`, reuse `wrangler
 * deploy`'s own credentials" approach `r2-sync-assets.ts` already
 * established for media - no S3 client, nothing new to authenticate. `get`/
 * `put` (push, and pull's non-listing half) are real, working `wrangler`
 * subcommands - only the listing call `pull`'s R2 branch depends on is
 * currently broken.
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
 * than adding a JSONC dependency for one field). Only actually called when
 * targeting a real/miniflare R2 bucket (`--remote`/`--local` on the
 * PUSH/PULL commands below), never for the plain local-disk case. */
async function bucketName(): Promise<string> {
  const raw = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(stripped) as { r2_buckets?: { binding: string; bucket_name: string }[] };
  const bucket = config.r2_buckets?.find((entry) => entry.binding === "MEDIA_BUCKET");
  if (!bucket) throw new Error('[drycms] wrangler.jsonc has no r2_buckets entry bound as "MEDIA_BUCKET".');
  return bucket.bucket_name;
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
  const bucket = isR2 ? await bucketName() : null;
  let written = 0;
  for (const file of files) {
    const relPath = relative(GIT_PAGES_ROOT, file).split("\\").join("/");
    if (isR2 && bucket) {
      const key = r2Prefix ? `${r2Prefix}/${relPath}` : relPath;
      const proc = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file, useLocalR2 ? "--local" : "--remote"]);
      if (proc.exitCode !== 0) {
        console.error(`[drycms] failed to push ${key}:\n${new TextDecoder().decode(proc.stderr)}`);
        process.exit(1);
      }
      console.log(`  push ${key}`);
      written += 1;
    } else {
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
  let written = 0;
  if (isR2) {
    const bucket = await bucketName();
    const proc = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "list", bucket, "--prefix", r2Prefix, useLocalR2 ? "--local" : "--remote", "--json"]);
    if (proc.exitCode !== 0) {
      console.error(`[drycms] failed to list "${bucket}/${r2Prefix}":\n${new TextDecoder().decode(proc.stderr)}`);
      process.exit(1);
    }
    // Best-effort JSON parse - `wrangler`'s exact list output shape hasn't
    // been verified against a real bucket for this script; a parse failure
    // surfaces loudly rather than silently pulling nothing.
    const parsed = JSON.parse(new TextDecoder().decode(proc.stdout)) as { objects?: { key: string }[] } | { key: string }[];
    const objects = Array.isArray(parsed) ? parsed : (parsed.objects ?? []);
    for (const object of objects) {
      const relPath = r2Prefix ? object.key.slice(r2Prefix.length).replace(/^\/+/, "") : object.key;
      const destPath = join(GIT_PAGES_ROOT, relPath);
      await mkdir(dirname(destPath), { recursive: true });
      const proc2 = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "get", `${bucket}/${object.key}`, "--file", destPath, useLocalR2 ? "--local" : "--remote"]);
      if (proc2.exitCode !== 0) {
        console.error(`[drycms] failed to pull ${object.key}:\n${new TextDecoder().decode(proc2.stderr)}`);
        process.exit(1);
      }
      console.log(`  pull ${relPath}`);
      written += 1;
    }
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
