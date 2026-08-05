/**
 * Snapshots the current dev content-type DB's full list (every content
 * type, including the built-in defaults - they're already there via the
 * normal boot seeding) into `dry.seed.json` at the repo root. Shared by
 * `bun run seed:sync` and `bun run build:schema` - see
 * `plans/content-type-seed.md`.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createContentEngineAdapter } from "../../src/content-types/engine/index.js";
import { content } from "../../src/server/config.js";

export async function writeContentTypeSeedFile(): Promise<{ count: number; target: string } | null> {
  if (content.engine === "D1") {
    console.log('[drycms] content.engine is "D1" - schema sync can\'t read it from a standalone script (no local D1 binding). Skipping.');
    return null;
  }

  const adapter = createContentEngineAdapter(content);
  const allTypes = await adapter.listContentTypes();

  const target = fileURLToPath(new URL("../../dry.seed.json", import.meta.url));
  // `$schema` (a VS Code/JSON-language-server convention, not part of the
  // PackagedSeed type itself - loadPackagedSeed() only ever reads
  // `.contentTypes`) points editors at `dry.seed.schema.json` for
  // autocomplete/validation on this file.
  await writeFile(target, `${JSON.stringify({ $schema: "./dry.seed.schema.json", contentTypes: allTypes }, null, 2)}\n`);

  return { count: allTypes.length, target };
}
