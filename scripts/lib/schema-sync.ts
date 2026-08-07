/**
 * Snapshots the current dev content-type DB's full list (every content
 * type, including the built-in defaults - they're already there via the
 * normal boot seeding) into `dry.seed.json` at the repo root, plus each
 * singleton's actual row value (`PackagedSeed.singletonData`, see
 * `src/content-types/seed.ts`). Shared by `bun run seed:sync` and
 * `bun run build:schema` - see `plans/content-type-seed.md`.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { EntryValue } from "../../src/content-types/engine/entry-codec.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../src/content-types/engine/index.js";
import type { PackagedSeed } from "../../src/content-types/seed.js";
import { content } from "../../src/server/config.js";

export async function writeContentTypeSeedFile(): Promise<{ count: number; singletonCount: number; target: string } | null> {
  if (content.engine === "D1") {
    console.log('[drycms] content.engine is "D1" - schema sync can\'t read it from a standalone script (no local D1 binding). Skipping.');
    return null;
  }

  const schemaAdapter = createContentEngineAdapter(content);
  const entryAdapter = createContentEntryEngineAdapter(content);
  const allTypes = await schemaAdapter.listContentTypes();

  const singletonData: Record<string, EntryValue> = {};
  for (const type of allTypes) {
    if (type.kind !== "singleton") continue;
    const row = await entryAdapter.getSingletonEntry(type, allTypes);
    if (row) singletonData[type.id] = row.value;
  }
  const singletonCount = Object.keys(singletonData).length;

  const target = fileURLToPath(new URL("../../dry.seed.json", import.meta.url));
  const seed: PackagedSeed = { contentTypes: allTypes };
  if (singletonCount > 0) seed.singletonData = singletonData;
  // `$schema` (a VS Code/JSON-language-server convention, not part of the
  // PackagedSeed type itself - loadPackagedSeed() only ever reads
  // `.contentTypes`/`.singletonData`) points editors at
  // `dry.seed.schema.json` for autocomplete/validation on this file.
  await writeFile(target, `${JSON.stringify({ $schema: "./dry.seed.schema.json", ...seed }, null, 2)}\n`);

  return { count: allTypes.length, singletonCount, target };
}
