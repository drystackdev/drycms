/**
 * Freezes the current dev DB's schema + media into two git-committable
 * artifacts, without running a full `bun run build`:
 *   - `dry.seed.json` (repo root) - every content type's definition, plus
 *     each singleton's actual row value (`PackagedSeed.singletonData`,
 *     applied once at first-admin-registration time by
 *     `content-types/seed.ts`'s `applyPackagedSingletonData`) - same as
 *     `bun run seed:sync` (`scripts/lib/schema-sync.ts`).
 *   - `public.zip` (repo root) - the whole `public/` directory (uploaded
 *     media + `dry-icons/`, see `resolveStorageOption()` in
 *     `server/options.ts` - local `storage` resolves straight to `public/`)
 *     zipped flat (no prefix), so it extracts back to `public/` with a
 *     plain `unzip public.zip -d public`.
 *
 * `public/` itself is gitignored (see `.gitignore`) - `public.zip` is the
 * artifact meant to be committed and pushed for deploy instead, since a
 * production build still needs `public/`'s real files on disk before
 * `vite build` runs; extract the zip as a step in that pipeline.
 *
 * Run with: bun run build:schema
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipDirectories } from "../src/lib/zip.js";
import { resolved } from "../src/server/config.js";
import { writeContentTypeSeedFile } from "./lib/schema-sync.js";

const schemaResult = await writeContentTypeSeedFile();
if (schemaResult) console.log(`[drycms] wrote ${schemaResult.count} content type(s) (${schemaResult.singletonCount} with singleton data) -> ${schemaResult.target}`);

if (resolved.storage.kind !== "local") {
  console.log(`[drycms] storage.kind is "${resolved.storage.kind}" - public.zip only makes sense for local storage. Skipping.`);
} else {
  const zip = await zipDirectories([{ prefix: "", dir: resolved.storage.root }]);
  const target = fileURLToPath(new URL("../public.zip", import.meta.url));
  if (!zip) {
    console.log(`[drycms] "${resolved.storage.root}" is empty - skipping public.zip.`);
  } else {
    await writeFile(target, zip);
    console.log(`[drycms] packaged public.zip (${zip.length} bytes) -> ${target}`);
  }
}
