import { createContext } from "preact";
import { useContext, useMemo } from "preact/hooks";
import { entryMediaFolderPath, tempEntryMediaFolderPath } from "../../content-types/entry-media-paths.js";
import type { FileManagerSource } from "../../storage/entry-types.js";
import { scopeFileSource } from "../../storage/scoped-source.js";
import { authState } from "../../store/auth.js";

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

/**
 * The `EntryMediaContext` above, resolved into the ready-to-use scoped
 * source every picker inside the entry form wants: `fullSource` sandboxed to
 * this entry's own media folder, or `undefined` when there's no entry folder
 * to point at (no context, no `features.slug`, or a saved entry whose slug
 * hasn't loaded/been typed yet). Shared by `ScalarField.tsx` (the `image`/
 * `file`/`richtext` fields' "Entry" tab) and `MagicChat.tsx` (the attach-
 * images picker, plus knowing which folder to tell the model about) so both
 * resolve the exact same folder from the exact same rules.
 */
export function useEntryMediaSource(fullSource: FileManagerSource): FileManagerSource | undefined {
  const entryMedia = useContext(EntryMediaContext);
  const folderPath = !entryMedia
    ? null
    : entryMedia.isNew
      ? tempEntryMediaFolderPath(entryMedia.collectionName, authState.value.user?.email ?? "")
      : entryMedia.slug
        ? entryMediaFolderPath(entryMedia.slug)
        : null;
  return useMemo(
    () => (folderPath ? scopeFileSource(fullSource, folderPath) : undefined),
    [fullSource, folderPath],
  );
}
