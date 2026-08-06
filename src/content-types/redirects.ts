import type { ContentEntryEngineAdapter } from "./engine/entries-types.js";
import type { ContentTypeDefinition } from "./types.js";

/**
 * Keeps the built-in `redirect` collection (`seed.ts`) in sync whenever a
 * slugged entry's slug changes, so its old public URL keeps working - see
 * `page-handler.ts`'s last-path-segment lookup on a route miss.
 *
 * - A row already pointing away from `toSlug` is deleted first: that path is
 *   live again, an old redirect shadowing it would be wrong.
 * - A row already redirecting `fromSlug` is updated in place rather than
 *   duplicated (`from` is unique, and this keeps repeated renames of the same
 *   entry from piling up a new row every time).
 * - Otherwise a fresh `{ from: fromSlug, to: toSlug }` row is created.
 *
 * Deliberately does NOT chase older rows whose `to === fromSlug` forward to
 * `toSlug` - collapsing multi-hop redirect chains is out of scope here.
 *
 * No-ops entirely if this app's content types don't include `redirect` (e.g.
 * a packaged `dry.seed.json` that dropped it).
 */
export async function recordSlugRedirect(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  fromSlug: string,
  toSlug: string,
): Promise<void> {
  if (fromSlug === toSlug) return;
  const redirectType = allTypes.find((t) => t.name === "redirect" && t.kind === "collection");
  if (!redirectType) return;

  const shadowing = await entryAdapter.findEntry(redirectType, allTypes, [{ field: "from", op: "eq", value: toSlug }]);
  if (shadowing) await entryAdapter.deleteEntry(redirectType, allTypes, shadowing.id);

  const existing = await entryAdapter.findEntry(redirectType, allTypes, [{ field: "from", op: "eq", value: fromSlug }]);
  if (existing) {
    await entryAdapter.updateEntry(redirectType, allTypes, existing.id, { from: fromSlug, to: toSlug });
  } else {
    await entryAdapter.createEntry(redirectType, allTypes, { from: fromSlug, to: toSlug });
  }
}
