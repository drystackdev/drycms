import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unzipToDirectories } from "../lib/zip.js";
import type { ResolvedDryOption } from "../server/options.js";

/**
 * Extracts a build-time-packaged `seed-assets.zip` (storage/icons/components/
 * pageComponents, see `scripts/build-seed-assets.mjs`) into the CURRENTLY
 * RUNNING server's own resolved local-filesystem roots - see
 * `plans/content-type-seed.md`. Deliberately covers only these 4 "real
 * asset" roots, not `pagesCache`/`typesCache` (caches, regenerate on their
 * own) or `kv` (runtime state, not a build-time asset).
 */
function prefixToDirFor(resolved: ResolvedDryOption): Record<string, string> {
  return {
    storage: resolved.storage.root,
    icons: resolved.icons.root,
    "components-storage": resolved.components.storage.root,
    "page-components-storage": resolved.pageComponents.storage.root,
  };
}

/**
 * Pure - given the zip's raw bytes (or `null`, meaning nothing was packaged),
 * extracts into `resolved`'s roots, which may be entirely different paths
 * than whatever the zip was built from (a production `dry.config.ts` can
 * customize `storage.root` etc. independently of the dev machine that ran
 * `bun run build`). Exported mainly so tests can exercise it without
 * touching the real bundled `seed-assets.zip` file.
 */
export async function applyPackagedSeedAssets(zipBuffer: Uint8Array | null, resolved: ResolvedDryOption): Promise<void> {
  if (!zipBuffer) return;
  await unzipToDirectories(zipBuffer, prefixToDirFor(resolved));
}

const SEED_ASSETS_ZIP_URL = new URL("./seed-assets.zip", import.meta.url);

/**
 * Real entry point - locates `seed-assets.zip` next to this module's own
 * compiled location (works no matter what `cwd` `node dist/server/
 * entry-node.js` is launched from) and extracts it. No-ops if the file
 * doesn't exist: a fresh `drycms` clone that never ran `seed:sync`/never had
 * any local storage to package, or one not using this feature at all.
 */
export async function extractPackagedSeedAssets(resolved: ResolvedDryOption): Promise<void> {
  let zipBuffer: Uint8Array;
  try {
    zipBuffer = await readFile(fileURLToPath(SEED_ASSETS_ZIP_URL));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await applyPackagedSeedAssets(zipBuffer, resolved);
}
