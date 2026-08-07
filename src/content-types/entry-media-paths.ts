import { slugify } from "../lib/slugify.js";

/** Root folder every slugged entry's media lives under, e.g. `entry/blog-post-1`.
 * Shared (isomorphic) between the client field pickers and the server-side
 * save/delete cascade in `entry-media.ts`, so both sides agree on the exact
 * same paths. */
export const ENTRY_MEDIA_ROOT = "entry";

export function entryMediaFolderPath(slug: string): string {
  return `${ENTRY_MEDIA_ROOT}/${slug}`;
}

/** Where a brand-new, not-yet-saved entry's uploads land until the first
 * save moves them under `entryMediaFolderPath()` - keyed by the uploading
 * user (not a random draft id) so it survives a page reload, at the cost of
 * two concurrent "New" sessions by the same user on the same collection
 * sharing one folder. Hidden from Media's normal listings (see the `.tmp.`
 * filter in `storage/local.ts`/`storage/r2.ts`) by its leading `.`. */
export function tempEntryMediaFolderPath(collectionName: string, userEmail: string): string {
  return `.tmp.${collectionName}.${slugify(userEmail)}`;
}
