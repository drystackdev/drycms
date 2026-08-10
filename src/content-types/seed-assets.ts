import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unzipToDirectories } from "../lib/zip.js";
import type { ResolvedDryOption } from "../server/options.js";

/**
 * Extracts a build-time-packaged `seed-assets.zip` (storage/icons/components,
 * see `scripts/build-seed-assets.ts`) into the CURRENTLY RUNNING server's own
 * resolved local-filesystem roots - see `plans/content-type-seed.md`.
 * Deliberately covers only these 3 "real asset" roots, not `pagesCache`/`typesCache` (caches, regenerate on their
 * own) or `kv` (runtime state, not a build-time asset). A root backed by
 * `kind: "r2"` has no local directory to extract into - skipped rather than
 * erroring, since a Workers/R2 deployment has no local filesystem for this
 * unzip step to touch at all.
 */
function prefixToDirFor(resolved: ResolvedDryOption): Record<string, string> {
  const candidates: Record<string, ResolvedDryOption["storage"]> = {
    storage: resolved.storage,
    icons: resolved.icons,
    "components-storage": resolved.components.storage,
  };
  const result: Record<string, string> = {};
  for (const [prefix, option] of Object.entries(candidates)) {
    if (option.kind === "local") result[prefix] = option.root;
  }
  return result;
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

/**
 * Real entry point - locates `seed-assets.zip` next to this module's own
 * compiled location (works no matter what `cwd` `node dist/server/
 * entry-node.js` is launched from) and extracts it. No-ops if the file
 * doesn't exist: a fresh `drycms` clone that never ran `seed:sync`/never had
 * any local storage to package, or one not using this feature at all.
 *
 * The zip's location is resolved HERE rather than at module scope on
 * purpose: `import.meta.url` is not a resolvable base URL in workerd, so a
 * module-scope `new URL(..., import.meta.url)` throws while Cloudflare is
 * merely validating the uploaded script - before any request runs. Under
 * `kind: "cloudflare"` the `prefixToDirFor` guard below returns first
 * anyway, so neither the URL nor `node:fs` is ever reached there.
 */
export async function extractPackagedSeedAssets(resolved: ResolvedDryOption): Promise<void> {
  // Every asset root R2-backed (a Workers deployment) - no local directory
  // to extract into, same "skipped rather than erroring" rule
  // `prefixToDirFor` documents.
  if (Object.keys(prefixToDirFor(resolved)).length === 0) return;

  let zipBuffer: Uint8Array;
  try {
    zipBuffer = await readFile(fileURLToPath(new URL("./seed-assets.zip", import.meta.url)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await applyPackagedSeedAssets(zipBuffer, resolved);
}
