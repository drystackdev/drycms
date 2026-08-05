/**
 * Reusable helpers for seeding content-type SCHEMA and ENTRY data straight
 * into the live content DB from a standalone `bun` script - the same
 * dependency-free pattern `scripts/seed-sync.ts`/`scripts/dry-generate.ts`
 * already use (imports real project `.ts` modules directly; Bun resolves
 * them natively, no Vite `ssrLoadModule` needed).
 *
 * `upsertContentType` is idempotent by NAME (same idea as `seed.ts`'s own
 * `pendingSeedStatements`): a type whose `name` already exists in the DB has
 * its `id`/`version` reused and its schema reconciled in place through the
 * real `planSave`/`applySave` engine API - never hand-rolled DDL - so every
 * validation/migration rule the admin UI itself relies on still applies.
 * Call upserts in dependency order: any `component` a later type embeds via
 * a `component` field must be upserted first, so its id already exists when
 * the embedding type's `config.componentId` is resolved.
 *
 * See the `seed-content-types` skill for the end-to-end workflow this is
 * meant to be used from.
 */
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../src/content-types/engine/index.js";
import type { ContentTypeDefinition, ContentTypeKind } from "../../src/content-types/types.js";
import { content } from "../../src/server/config.js";

if (content.engine === "D1") {
  throw new Error(
    '[drycms] content.engine is "D1" - content-seed.ts needs a local sqlite file to run standalone (no D1 binding outside a request).',
  );
}

const schemaAdapter = createContentEngineAdapter(content);
const entryAdapter = createContentEntryEngineAdapter(content);

/** Creates a content type on first run, or reconciles an existing one (same
 * `name`, case-insensitively) to match `def` on every re-run - the `id`
 * passed in `def` is only ever used for a brand-new type; an existing type
 * keeps its real id and current `version` so the save doesn't hit a
 * `version_conflict`. */
export async function upsertContentType(
  def: Omit<ContentTypeDefinition, "version"> & { id: string },
): Promise<ContentTypeDefinition> {
  const existing = (await schemaAdapter.listContentTypes()).find((t) => t.name.toLowerCase() === def.name.toLowerCase());
  const next: ContentTypeDefinition = {
    ...def,
    id: existing?.id ?? def.id,
    version: existing?.version ?? 0,
  };
  const plan = await schemaAdapter.planSave(next);
  const saved = await schemaAdapter.applySave(next, plan);
  console.log(`[seed] content type "${saved.name}" (${saved.kind}) -> v${saved.version}`);
  return saved;
}

async function findType(name: string, kind: ContentTypeKind): Promise<{ type: ContentTypeDefinition; allTypes: ContentTypeDefinition[] }> {
  const allTypes = await schemaAdapter.listContentTypes();
  const type = allTypes.find((t) => t.name === name);
  if (!type) throw new Error(`[seed] no content type named "${name}" - upsert it first.`);
  if (type.kind !== kind) throw new Error(`[seed] "${name}" is a ${type.kind}, not a ${kind}.`);
  return { type, allTypes };
}

/** Upsert (create-or-replace) a singleton's one row. */
export async function writeSingletonEntry(name: string, value: Record<string, unknown>): Promise<void> {
  const { type, allTypes } = await findType(name, "singleton");
  await entryAdapter.saveSingletonEntry(type, allTypes, value);
  console.log(`[seed] singleton "${name}" entry saved`);
}

/** Inserts one new row into a collection. Not idempotent on its own - a
 * script that re-runs should call `clearCollection` first (see below) if it
 * wants to reseed rather than accumulate duplicates. */
export async function insertCollectionEntry(name: string, value: Record<string, unknown>): Promise<void> {
  const { type, allTypes } = await findType(name, "collection");
  await entryAdapter.createEntry(type, allTypes, value);
}

/** Deletes every existing row of a collection - call before a batch of
 * `insertCollectionEntry` calls so re-running a seed script replaces the
 * data instead of piling up duplicates on every run. */
export async function clearCollection(name: string): Promise<void> {
  const { type, allTypes } = await findType(name, "collection");
  const page = await entryAdapter.listEntries(type, allTypes, { page: 0, pageSize: 1000 });
  for (const row of page.rows) await entryAdapter.deleteEntry(type, allTypes, row.id);
  if (page.rows.length > 0) console.log(`[seed] cleared ${page.rows.length} existing "${name}" row(s)`);
}
