/**
 * Zips the current `storage`/`icons`/`components` roots
 * into `dist/server/seed-assets.zip` - the app's own packaged seed assets,
 * extracted at first-superadmin-registration time by
 * `content-types/seed-assets.ts`'s `extractPackagedSeedAssets`. See
 * `plans/content-type-seed.md`.
 *
 * Run with: bun run build (chained after `vite build --ssr`, which is what
 * creates `dist/server/` in the first place - see `package.json`'s `build`
 * script). A plain `.ts` script run directly via `bun`, same reasoning as
 * `dry-generate.ts`: it imports real project `.ts` modules
 * (`server/config.ts`, `lib/zip.ts`), which `bun` resolves natively.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipDirectories } from "../src/lib/zip.js";
import { resolved } from "../src/server/config.js";

const roots = [
  { prefix: "storage", dir: resolved.storage.root },
  { prefix: "icons", dir: resolved.icons.root },
  { prefix: "components-storage", dir: resolved.components.storage.root },
];

const zip = await zipDirectories(roots);
const target = fileURLToPath(new URL("../dist/server/seed-assets.zip", import.meta.url));

if (!zip) {
  console.log("[drycms] no local storage/icons/components assets found - skipping seed-assets.zip.");
} else {
  await writeFile(target, zip);
  console.log(`[drycms] packaged seed-assets.zip (${zip.length} bytes) -> ${target}`);
}
