/**
 * Uploads the local asset roots into the Cloudflare R2 bucket the deployed
 * Worker reads from - the Workers counterpart to `build-seed-assets.ts`.
 *
 * Why this exists as a deploy step rather than something the Worker does
 * itself: `content-types/seed-assets.ts`'s `extractPackagedSeedAssets` only
 * ever unzips into LOCAL directories (`prefixToDirFor` filters to
 * `kind === "local"`), so under `kind: "cloudflare"` - where every root is
 * R2 - it correctly does nothing. Nor could it: the Worker has no filesystem
 * to read `dist/server/seed-assets.zip` from, `build:worker` doesn't even
 * produce that zip, and inlining ~7MB of media into the script would blow
 * past the Workers size limit. Media belongs in the bucket, put there from
 * outside.
 *
 * Run with:
 *   bun run r2:sync            # the real bucket (what `deploy` needs)
 *   bun run r2:sync --local    # miniflare's local R2, for `wrangler dev`
 *
 * Runs from a machine that HAS the local roots - `public/` is gitignored, so
 * a fresh clone (Cloudflare's build machine included) has no media to send
 * and this is not part of `deploy`. Media changes far less often than code;
 * run it by hand after changing media, and the bucket keeps serving it
 * across every later deploy.
 *
 * A plain `.ts` script run directly via `bun`, same reasoning as
 * `build-seed-assets.ts`: it imports real project `.ts` modules, which `bun`
 * resolves natively. It shells out to `wrangler r2 object put` rather than
 * talking to the R2 API itself, so it reuses the same credentials
 * `wrangler deploy` already uses and needs no S3 client.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { resolveOptions } from "../src/server/options.js";

const useLocal = process.argv.includes("--local");

/**
 * `icons` is deliberately absent: its local root is `public/dry-icons` (a
 * subfolder of `storage`'s own `public/` root) and its R2 prefix is
 * `storage/dry-icons` - the same nesting on both sides, so walking `storage`
 * recursively already carries it to exactly the right keys. Listing it again
 * would upload every icon twice. `resolveOptions` is called with an explicit
 * `kind` for each side rather than reading the app's own resolved config
 * (`src/server/config.ts`), which only ever resolves ONE `kind` per build
 * and would give this script only one of the two halves it needs to pair up.
 */
const localRoots = resolveOptions({ kind: "local" });
const r2Roots = resolveOptions({ kind: "cloudflare" });

const pairs = [
  { dir: localRoots.storage, r2: r2Roots.storage },
  { dir: localRoots.components.storage, r2: r2Roots.components.storage },
  { dir: localRoots.pageComponents.storage, r2: r2Roots.pageComponents.storage },
];

/** `wrangler.jsonc` is the single source of truth for the bucket name, the
 * same file `wrangler deploy` reads - parsed here by stripping `//` comments
 * (it has no block comments or trailing commas) rather than adding a JSONC
 * dependency for one field. */
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
    // A root that was never created locally (no richtext/page components
    // built yet) - nothing to sync, not an error.
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    // `.dir` markers exist only to give an empty folder a presence; R2's own
    // marker convention is written by the storage adapter, not seeded here.
    else if (entry.isFile() && entry.name !== ".dir") found.push(full);
  }
  return found;
}

const bucket = await bucketName();
let uploaded = 0;
let bytes = 0;

for (const pair of pairs) {
  if (pair.dir.kind !== "local" || pair.r2.kind !== "r2") continue;
  const files = await filesUnder(pair.dir.root);
  if (files.length === 0) {
    console.log(`[drycms] "${pair.dir.root}" is empty or missing - nothing to sync for "${pair.r2.prefix}".`);
    continue;
  }

  for (const file of files) {
    const relPath = relative(pair.dir.root, file).split("\\").join("/");
    const key = pair.r2.prefix ? `${pair.r2.prefix}/${relPath}` : relPath;
    const proc = Bun.spawnSync([
      "bunx",
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucket}/${key}`,
      "--file",
      file,
      useLocal ? "--local" : "--remote",
    ]);
    if (proc.exitCode !== 0) {
      console.error(`[drycms] failed to upload ${key}:\n${new TextDecoder().decode(proc.stderr)}`);
      process.exit(1);
    }
    const size = (await stat(file)).size;
    uploaded += 1;
    bytes += size;
    console.log(`  ${key} (${size} bytes)`);
  }
}

console.log(
  `[drycms] synced ${uploaded} file(s), ${bytes} bytes -> ${useLocal ? "local" : "remote"} R2 bucket "${bucket}".`,
);
