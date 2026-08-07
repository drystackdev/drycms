import { createContext } from "preact";

export interface EntryMediaInfo {
  /** The content type's technical name - `entry-media-paths.ts`'s temp
   * folder namespace, and `content-entries.ts`'s cascade uses the same
   * value server-side. */
  collectionName: string;
  /** The entry's current `slug` field value, live as the admin types -
   * `null` until a slug has been entered (or before the type's `features.slug`
   * data has loaded). */
  slug: string | null;
  /** Not yet saved once (no DB row/id yet) - uploads go to the per-user temp
   * folder instead of `entry/<slug>/` until the first save (`entry-media.ts`'s
   * `syncEntryMediaFolder`). */
  isNew: boolean;
}

/**
 * Threads the current entry's identity down to `ScalarField.tsx` (and from
 * there into `ImageField`/`FileField`/`RichTextField`) so a file/image
 * picker inside the entry form can build a `scopeFileSource`-wrapped "Entry"
 * tab pointed at that entry's own media folder - `ContentEntryEditor.tsx`
 * provides it, only when `type.features?.slug` is on. `null` everywhere else
 * (a type with no slug feature, or a picker outside any entry form, e.g. the
 * content-type editor's default-value fields, or the standalone Media page)
 * - those pickers stay exactly as they were, with no Entry tab.
 */
export const EntryMediaContext = createContext<EntryMediaInfo | null>(null);
