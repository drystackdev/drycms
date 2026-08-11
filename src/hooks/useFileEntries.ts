import { useEffect, useState } from "preact/hooks";
import type { FileEntry, FileManagerSource } from "../storage/entry-types.js";
import { parentFolderOf } from "../storage/entry-utils.js";
import { isInScopeOf } from "../storage/scoped-source.js";

/**
 * Resolves picked storage ids (an `image`/`file` field's stored value) back to
 * the `FileEntry`s behind them, for the thumbnail/icon + name a picker field
 * shows once something's chosen. Re-lists on every id change, since a rename/
 * move elsewhere in `source` can leave a stale id.
 *
 * `entrySource` (the current entry's own media folder, see
 * `entry-media-context.ts`) is consulted as well, and it isn't optional
 * polish: a brand-new entry uploads into a hidden `.tmp.*` folder that
 * `storage/local.ts` deliberately omits from normal listings - so an id
 * picked on the Entry tab resolves through the SCOPED source or not at all,
 * and the field would otherwise fall back to its empty "Choose image" state
 * right after a successful pick.
 *
 * Only the *first* id's folder is used as the fallback scope when `source`
 * can't `listAll` - multi-folder selections aren't expected from sources
 * without it.
 */
export function useFileEntries(
  ids: string[],
  source: FileManagerSource,
  entrySource?: FileManagerSource,
): Record<string, FileEntry> {
  const [entriesById, setEntriesById] = useState<Record<string, FileEntry>>({});
  const idsKey = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) {
      setEntriesById({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const all = (await source.listAll?.()) ?? null;
      const list = all ?? (await source.list(parentFolderOf(ids[0]!)));
      // Skipped entirely unless some id actually lives in the entry folder -
      // no reason to pay for a second listing on the common case.
      const scoped =
        entrySource && ids.some((id) => isInScopeOf(entrySource, id))
          ? ((await entrySource.listAll?.()) ?? (await entrySource.list(null)))
          : [];
      if (cancelled) return;
      const map: Record<string, FileEntry> = {};
      for (const id of ids) {
        const found = list.find((item) => item.id === id) ?? scoped.find((item) => item.id === id);
        if (found) map[id] = found;
      }
      setEntriesById(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, source, entrySource]);

  return entriesById;
}
