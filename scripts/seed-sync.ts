/**
 * Snapshots the CURRENT dev content-type DB's full list (every content type,
 * including the 6 built-in defaults from `content-types/seed.ts` - they're
 * already there via the normal boot seeding) into `dry.seed.json` at the
 * repo root. This is the "separate seed script" from `plans/
 * content-type-seed.md`: overwrites the file wholesale each run (a
 * snapshot, not a merge) - a type removed from the dev DB since the last
 * sync simply stops appearing.
 *
 * Run with: bun run seed:sync
 *
 * A plain `.ts` script run directly via `bun`, same reasoning as
 * `dry-generate.ts`: imports real project `.ts` modules and `bun` resolves
 * them natively.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createContentEngineAdapter } from "../src/content-types/engine/index.js";
import { content } from "../src/server/config.js";

if (content.engine === "D1") {
  console.log('[drycms] content.engine is "D1" - seed:sync can\'t read it from a standalone script (no local D1 binding). Skipping.');
  process.exit(0);
}

const adapter = createContentEngineAdapter(content);
const allTypes = await adapter.listContentTypes();

const target = fileURLToPath(new URL("../dry.seed.json", import.meta.url));
await writeFile(target, `${JSON.stringify({ contentTypes: allTypes }, null, 2)}\n`);

console.log(`[drycms] seed:sync wrote ${allTypes.length} content type(s) -> ${target}`);
