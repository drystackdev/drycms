/**
 * Plain-JS, `node`-only helper for `sync-pages-r2.ts`'s `--local` R2 path -
 * split out into its own file (instead of just calling `getPlatformProxy`
 * inline from that script) because `getPlatformProxy` does NOT work under
 * `bun` in this project: confirmed live (2026-08-09) by direct reproduction
 * - the exact same call that returns instantly under `node` either throws
 * `DataCloneError: The object can not be cloned.` or hangs indefinitely
 * under `bun run`/`bun scripts/...`, depending on which binding is touched
 * first. `sync-pages-r2.ts` itself stays a `bun`-run TypeScript script (same
 * as every other file under `scripts/`) - it spawns THIS file with plain
 * `node` as a subprocess for the one piece of work that actually needs it,
 * same "only Node can run this specific tool" carve-out
 * `built-pages-storage.ts`'s `ensurePreactRuntimeAsset` already established
 * for Vite/esbuild tooling under workerd for an analogous reason.
 *
 * Deliberately plain `.mjs`, no TypeScript/project imports beyond `wrangler`
 * itself (a real npm package, resolves normally under `node`) - pulling in
 * this project's OWN `.ts` sources (e.g. `resolveOptions`) here would hit
 * the same `.js`-suffixed-specifier-resolving-to-`.ts`-file problem plain
 * `node` can't do without bundler-style resolution (confirmed live: that's
 * exactly the wall hit trying to run `sync-pages-r2.ts` itself under `node`
 * directly instead of through this split). All config values it needs
 * (`prefix`/`rootDir`) are passed in as plain CLI args from the calling
 * script instead.
 *
 * Usage: `node r2-local-bucket.mjs <pull|push> <r2Prefix> <rootDir>`
 * - matches `getPlatformProxy`'s default `persist` location
 *   (`.wrangler/state/v3`), the SAME storage a real `wrangler dev`/
 *   `dev:worker` session reads/writes - `remoteBindings: false` is a
 *   deliberate safety rail so this can never reach the real bucket even if
 *   some binding is ever marked `remote: true` in `wrangler.jsonc`.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { getPlatformProxy } from "wrangler";

const [, , mode, prefix, rootDir] = process.argv;
if ((mode !== "pull" && mode !== "push") || !rootDir) {
  console.error("[drycms] usage: node r2-local-bucket.mjs <pull|push> <r2Prefix> <rootDir>");
  process.exit(1);
}

/** Same empty-folder-marker/staging-folder exclusion `storage/r2.ts`'s own
 * `isHiddenName` applies to every listing - this walks raw object keys
 * directly (not through that adapter), so it has to repeat the filter. */
function isHiddenPulledName(relPath) {
  const leaf = relPath.slice(relPath.lastIndexOf("/") + 1);
  return leaf === ".dir" || leaf.startsWith(".tmp.");
}

async function filesUnder(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full)));
    else if (entry.isFile() && entry.name !== ".dir") found.push(full);
  }
  return found;
}

const proxy = await getPlatformProxy({ remoteBindings: false });
const bucket = proxy.env.MEDIA_BUCKET;
let written = 0;
try {
  if (mode === "pull") {
    let cursor;
    for (;;) {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const object of page.objects) {
        const relPath = prefix ? object.key.slice(prefix.length).replace(/^\/+/, "") : object.key;
        if (!relPath || isHiddenPulledName(relPath)) continue;
        const got = await bucket.get(object.key);
        if (!got) continue; // vanished between list and get - skip, not fatal
        const destPath = join(rootDir, relPath);
        await mkdir(dirname(destPath), { recursive: true });
        const bytes = new Uint8Array(await new Response(got.body).arrayBuffer());
        await writeFile(destPath, bytes);
        console.log(`  pull ${relPath}`);
        written += 1;
      }
      if (!page.truncated || !page.cursor) break;
      cursor = page.cursor;
    }
  } else {
    const files = await filesUnder(rootDir);
    for (const file of files) {
      const relPath = relative(rootDir, file).split("\\").join("/");
      const key = prefix ? `${prefix}/${relPath}` : relPath;
      await bucket.put(key, new Uint8Array(await readFile(file)));
      console.log(`  push ${key}`);
      written += 1;
    }
  }
  console.log(`[drycms] ${mode === "pull" ? "pulled" : "pushed"} ${written} file(s) (destination overwritten if already present).`);
} finally {
  await proxy.dispose();
}
