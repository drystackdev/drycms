/**
 * Snapshots the current dev content-type DB's OWN content types/data - the
 * 12 built-in system defaults (`defaultContentTypeDefinitions()`) are
 * EXCLUDED, since those are always seeded automatically at boot and never
 * need to travel between installs - into two plain export/import artifacts:
 * `src/apps/schema.json` (`{contentTypes}`) and `src/apps/seed.json`
 * (`{singletonData, menuData}`). Neither is imported by any runtime code
 * (both are gitignored) - an admin picks them up through the Content Types
 * page's "Upload schema"/"Upload seed data" buttons
 * (`routes/content-type-seed.ts`) instead. Written by `bun run seed:sync`.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { EntryValue } from "../../src/content-types/engine/entry-codec.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../src/content-types/engine/index.js";
import { defaultContentTypeDefinitions, MENU_TYPE_ID } from "../../src/content-types/seed.js";
import { content } from "../../src/server/config.js";

export interface WriteContentTypeSeedFileResult {
  schemaCount: number;
  singletonCount: number;
  menuCount: number;
  schemaTarget: string;
  seedTarget: string;
}

export async function writeContentTypeSeedFile(): Promise<WriteContentTypeSeedFileResult | null> {
  if (content.engine === "D1") {
    console.log('[drycms] content.engine is "D1" - schema sync can\'t read it from a standalone script (no local D1 binding). Skipping.');
    return null;
  }

  const schemaAdapter = createContentEngineAdapter(content);
  const entryAdapter = createContentEntryEngineAdapter(content);
  const allTypes = await schemaAdapter.listContentTypes();
  const systemIds = new Set(defaultContentTypeDefinitions().map((t) => t.id));
  const appTypes = allTypes.filter((t) => !systemIds.has(t.id));

  const singletonData: Record<string, EntryValue> = {};
  for (const type of allTypes) {
    // System singletons (`seoDefaults`/`systemSettings`/`googleVerification`/
    // `githubSync`) hold per-deployment operational config, not app
    // content - never something to carry between installs or silently push
    // onto another live site through "Upload seed data".
    if (type.kind !== "singleton" || systemIds.has(type.id)) continue;
    const row = await entryAdapter.getSingletonEntry(type, allTypes);
    if (row) singletonData[type.id] = row.value;
  }
  const singletonCount = Object.keys(singletonData).length;

  // `menu` only - see `applyPackagedMenuData`. `pageSize` is generous rather
  // than paginated: a navigation menu is a handful of rows by nature, and a
  // partial snapshot would seed a silently truncated menu.
  const menuType = allTypes.find((type) => type.id === MENU_TYPE_ID && type.kind === "collection");
  const menuData = menuType
    ? (await entryAdapter.listEntries(menuType, allTypes, { page: 0, pageSize: 500 })).rows.map((row) => row.value)
    : [];

  const schemaTarget = fileURLToPath(new URL("../../src/apps/schema.json", import.meta.url));
  const seedTarget = fileURLToPath(new URL("../../src/apps/seed.json", import.meta.url));
  await writeFile(schemaTarget, `${JSON.stringify({ contentTypes: appTypes }, null, 2)}\n`);
  await writeFile(seedTarget, `${JSON.stringify({ singletonData, menuData }, null, 2)}\n`);

  return { schemaCount: appTypes.length, singletonCount, menuCount: menuData.length, schemaTarget, seedTarget };
}
