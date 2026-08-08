/**
 * Syncs `src/apps/pages/**` <-> the `pagesSource` storage root
 * (`plans/app-r2.md` quyết định #6). Git stays the source of truth for the
 * INITIAL state of every page; the browser build pipeline (once it exists)
 * writes further edits straight to storage, never back to disk - so this
 * script is deliberately ONE-DIRECTION-SAFE in both modes: it only ever
 * fills in what the DESTINATION is missing, never overwrites something
 * already there. One lỡ tay running this the wrong way must not erase code
 * a user already edited in the browser (push) or already committed (pull).
 *
 * Run with:
 *   bun run pages:sync --push            # git -> storage, local kind
 *   bun run pages:sync --push --remote   # git -> storage, real R2 bucket
 *   bun run pages:sync --push --local    # git -> storage, miniflare local R2
 *   bun run pages:sync --pull [--remote|--local]   # storage -> git
 *
 * Same "shell out to `wrangler r2 object put/get/list`, reuse `wrangler
 * deploy`'s own credentials" approach `r2-sync-assets.ts` already
 * established for media - no S3 client, nothing new to authenticate.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveOptions } from "../src/server/options.js";

const args = process.argv.slice(2);
const mode = args.includes("--push") ? "push" : args.includes("--pull") ? "pull" : null;
if (!mode) {
  console.error(
    "[drycms] usage: bun run pages:sync --push|--pull [--remote|--local]\n" +
      "  (no flag = plain local disk root, kind \"local\" deployments;\n" +
      "   --remote = real R2 bucket; --local = miniflare local R2, for wrangler dev)",
  );
  process.exit(1);
}
// 3-way, not a boolean: no flag = target the plain local-disk root (`kind:
// "local"` deployments never touch R2 at all); `--remote`/`--local` both
// target R2 (real vs. miniflare), same distinction `r2-sync-assets.ts`'s
// own `--local` flag makes.
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

async function existsLocally(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether `key` already exists in the real/miniflare R2 bucket - probed by
 * attempting a `get` into a throwaway path rather than a `head`-style
 * subcommand (not confirmed present in every installed `wrangler` version);
 * the probed bytes are discarded either way, `push`/`pull` below re-fetch or
 * re-upload deliberately rather than reusing this call's output. This is
 * the least-exercised part of this script - not run against a real bucket
 * as part of building it (see `status/app-r2-build.md`); verify against a
 * real/miniflare bucket before relying on it. */
async function existsInR2(bucket: string, key: string): Promise<boolean> {
  const probePath = join(process.env.TMPDIR ?? "/tmp", `drycms-pages-sync-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const proc = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "get", `${bucket}/${key}`, "--file", probePath, useLocalR2 ? "--local" : "--remote"]);
  await Bun.file(probePath).delete().catch(() => undefined);
  return proc.exitCode === 0;
}

async function push(): Promise<void> {
  const files = await filesUnder(GIT_PAGES_ROOT);
  if (files.length === 0) {
    console.log(`[drycms] "${GIT_PAGES_ROOT}" is empty - nothing to push.`);
    return;
  }
  const bucket = isR2 ? await bucketName() : null;
  let written = 0;
  let skipped = 0;
  for (const file of files) {
    const relPath = relative(GIT_PAGES_ROOT, file).split("\\").join("/");
    if (isR2 && bucket) {
      const key = r2Prefix ? `${r2Prefix}/${relPath}` : relPath;
      if (await existsInR2(bucket, key)) {
        skipped += 1;
        continue;
      }
      const proc = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file, useLocalR2 ? "--local" : "--remote"]);
      if (proc.exitCode !== 0) {
        console.error(`[drycms] failed to push ${key}:\n${new TextDecoder().decode(proc.stderr)}`);
        process.exit(1);
      }
      console.log(`  push ${key}`);
      written += 1;
    } else {
      const destPath = join(storageRoot.kind === "local" ? storageRoot.root : "", relPath);
      if (await existsLocally(destPath)) {
        skipped += 1;
        continue;
      }
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await readFile(file));
      console.log(`  push ${relPath}`);
      written += 1;
    }
  }
  console.log(`[drycms] pushed ${written} file(s), skipped ${skipped} already-present (never overwritten).`);
}

async function pull(): Promise<void> {
  let written = 0;
  let skipped = 0;
  if (isR2) {
    const bucket = await bucketName();
    const proc = Bun.spawnSync(["bunx", "wrangler", "r2", "object", "list", bucket, "--prefix", r2Prefix, useLocalR2 ? "--local" : "--remote", "--json"]);
    if (proc.exitCode !== 0) {
      console.error(`[drycms] failed to list "${bucket}/${r2Prefix}":\n${new TextDecoder().decode(proc.stderr)}`);
      process.exit(1);
    }
    // Best-effort JSON parse - `wrangler`'s exact list output shape hasn't
    // been verified against a real bucket for this script (see
    // `existsInR2`'s doc comment); a parse failure surfaces loudly rather
    // than silently pulling nothing.
    const parsed = JSON.parse(new TextDecoder().decode(proc.stdout)) as { objects?: { key: string }[] } | { key: string }[];
    const objects = Array.isArray(parsed) ? parsed : (parsed.objects ?? []);
    for (const object of objects) {
      const relPath = r2Prefix ? object.key.slice(r2Prefix.length).replace(/^\/+/, "") : object.key;
      const destPath = join(GIT_PAGES_ROOT, relPath);
      if (await existsLocally(destPath)) {
        skipped += 1;
        continue;
      }
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
      if (await existsLocally(destPath)) {
        skipped += 1;
        continue;
      }
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await readFile(file));
      console.log(`  pull ${relPath}`);
      written += 1;
    }
  }
  console.log(`[drycms] pulled ${written} file(s), skipped ${skipped} already-present (never overwritten).`);
}

if (mode === "push") await push();
else await pull();
