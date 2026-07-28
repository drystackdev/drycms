import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import CheckField from "../components/CheckField.js";
import Combobox, { type ComboboxOption } from "../components/Combobox.js";
import { ArrowLeftIcon, ArrowRightIcon } from "../components/icons.js";
import IconGlyph from "../components/IconGlyph.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import {
  createIconifyApi,
  type IconifyCollection,
} from "../icons/iconify-http-api.js";
import { createIconsApi } from "../icons/icons-http-api.js";
import { useDocumentTitle } from "./page-common.js";

const DEFAULT_PREFIX = "solar";
const SEARCH_LIMIT = 64;
const SEARCH_DEBOUNCE_MS = 300;
/** Matches `IconManagement`'s own grid page size, for a consistent pager
 * feel between "browse a saved icon" and "browse a category to import from". */
const BROWSE_PAGE_SIZE = 48;

/** A percent-encoded (not base64) SVG data URI - simpler and more robust
 * than `btoa`, which throws on anything outside Latin1. Fed to `IconGlyph`
 * (a CSS mask, not `dangerouslySetInnerHTML`) same as everywhere else this
 * feature displays an icon, even though these are only-just-fetched previews
 * that haven't been saved yet. */
function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function splitId(id: string): [prefix: string, name: string] {
  const colon = id.indexOf(":");
  return [id.slice(0, colon), id.slice(colon + 1)];
}

export default function IconSearchAdd() {
  useDocumentTitle("Add icon");
  const { route } = useLocation();
  const iconifyApi = useMemo(() => createIconifyApi(`${path}/api/iconify`), []);
  const iconsApi = useMemo(() => createIconsApi(`${path}/api/icons`), []);

  const [collections, setCollections] = useState<IconifyCollection[]>([]);
  const [category, setCategory] = useState(DEFAULT_PREFIX);
  const [searchAll, setSearchAll] = useState(false);
  const [query, setQuery] = useState("");
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Browsing: the full (flattened/de-duped) name list for `category`, shown
  // page by page when there's no query yet instead of an empty grid -
  // "Search all icon sets" has no single-category listing to browse, so
  // that combination still waits for a real query, same as before.
  const [browseNames, setBrowseNames] = useState<string[]>([]);
  const [browsePage, setBrowsePage] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const isBrowsing = !query.trim() && !searchAll;

  useEffect(() => {
    iconifyApi
      .collections()
      .then(setCollections)
      .catch(() => {
        // Non-fatal: the Select just falls back to the default "solar" option below.
      });
  }, [iconifyApi]);

  const collectionOptions: ComboboxOption[] = useMemo(() => {
    const known = collections.some((c) => c.prefix === DEFAULT_PREFIX);
    const base = known
      ? collections
      : [{ prefix: DEFAULT_PREFIX, name: "Solar" }, ...collections];
    return base
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: c.prefix, label: c.name }));
  }, [collections]);

  // Debounced search - re-runs whenever the query, category, or the
  // "search all" toggle changes.
  useEffect(() => {
    if (!query.trim()) {
      setResultIds([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      iconifyApi
        .search({
          query,
          prefixes: searchAll ? undefined : [category],
          limit: SEARCH_LIMIT,
        })
        .then((result) => {
          setResultIds(result.icons);
          setError(null);
        })
        .catch((err) =>
          setError(err instanceof Error ? err.message : "Search failed."),
        )
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [iconifyApi, query, category, searchAll]);

  // Prefetches the current category's full name listing whenever it changes
  // (regardless of whether the search box is empty right now) - so clearing
  // the query shows the browse grid immediately instead of a loading flash.
  useEffect(() => {
    if (searchAll) return;
    let cancelled = false;
    setBrowseLoading(true);
    setBrowsePage(0);
    iconifyApi
      .list(category)
      .then((result) => {
        if (cancelled) return;
        setBrowseNames(result.names);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load this icon set.",
        );
      })
      .finally(() => {
        if (!cancelled) setBrowseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [iconifyApi, category, searchAll]);

  const browsePageCount = Math.max(
    1,
    Math.ceil(browseNames.length / BROWSE_PAGE_SIZE),
  );
  const browsePageIds = useMemo(
    () =>
      browseNames
        .slice(
          browsePage * BROWSE_PAGE_SIZE,
          browsePage * BROWSE_PAGE_SIZE + BROWSE_PAGE_SIZE,
        )
        .map((name) => `${category}:${name}`),
    [browseNames, browsePage, category],
  );
  const displayIds = isBrowsing ? browsePageIds : resultIds;

  // Fetches previews for whichever *currently displayed* ids aren't already
  // cached (search results or the current browse page, whichever is showing)
  // - `previews` is deliberately excluded from the deps below (read only to
  // compute `missing`, not to retrigger this effect on every fetch).
  useEffect(() => {
    const missing = displayIds.filter((id) => !(id in previews));
    if (missing.length === 0) return;
    let cancelled = false;
    iconifyApi
      .previewIcons(missing)
      .then((icons) => {
        if (cancelled) return;
        setPreviews((current) => ({ ...current, ...icons }));
      })
      .catch(() => {
        // A missed preview just leaves that tile blank - not fatal.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `previews` intentionally excluded, see comment above.
  }, [displayIds, iconifyApi]);

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    setImporting(true);
    setError(null);
    const namesByPrefix = new Map<string, string[]>();
    for (const id of selected) {
      const [prefix, name] = splitId(id);
      const names = namesByPrefix.get(prefix);
      if (names) names.push(name);
      else namesByPrefix.set(prefix, [name]);
    }

    Promise.all(
      [...namesByPrefix.entries()].map(([prefix, names]) =>
        iconsApi.importFromIconify({ prefix, names }),
      ),
    )
      .then((results) => {
        const created = results.reduce((sum, r) => sum + r.created.length, 0);
        const skipped = results.reduce((sum, r) => sum + r.skipped.length, 0);
        toast.add({
          type: skipped > 0 && created === 0 ? "warning" : "success",
          title: `Added ${created} icon${created === 1 ? "" : "s"}${skipped > 0 ? `, skipped ${skipped}` : ""}.`,
        });
        route(`${path}/icon-management`);
      })
      .catch((err) => {
        setImporting(false);
        setError(err instanceof Error ? err.message : "Failed to add icons.");
      });
  };

  return (
    <div class="card">
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Add icon</h1>
          <p>Search Iconify and add icons to your library.</p>
        </div>
      </div>

      <div class="row icon-tool-search">
        <input
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="e.g. home, arrow, user"
        />
        <Combobox
          options={collectionOptions}
          value={category}
          onChange={setCategory}
          disabled={searchAll}
          placeholder="Icon set"
        />
        <CheckField
          outline
          value={searchAll}
          onChange={setSearchAll}
          label="Search all icon sets"
          role="switch"
        />
      </div>

      <div class="row">
        <div>
          {error && <span class="error">{error}</span>}
          {searching && <span class="hint">Searching...</span>}
          {!searching && query.trim() && resultIds.length === 0 && (
            <span class="hint">No results.</span>
          )}
          {isBrowsing && browseLoading && <span class="hint">Loading...</span>}
          {isBrowsing && !browseLoading && browseNames.length === 0 && (
            <span class="hint">No icons in this set.</span>
          )}
        </div>

        <span class="spacer" />

        <div class="row">
          <button
            type="button"
            class="outline"
            onClick={() => route(`${path}/icon-management`)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || importing}
            onClick={handleAdd}
          >
            Add <small class="badge secondary">{selected.size}</small>
          </button>
        </div>
      </div>

      <div class="under" style={{minHeight: 545}}>
        <div class="icon-grid">
          {displayIds.map((id) => (
            <button
              type="button"
              key={id}
              class={
                "ghost " +
                (selected.has(id) ? "icon-cell selected" : "icon-cell")
              }
              onClick={() => toggleSelect(id)}
              style={{
                height: "unset",
              }}
            >
              {previews[id] ? (
                <IconGlyph src={svgToDataUri(previews[id])} size={24} />
              ) : (
                <div class="center">
                  <progress
                    class="circle"
                    style={{ height: "1.75rem", width: "1.75rem" }}
                  />
                </div>
              )}
              <small class="mono">{splitId(id)[1]}</small>
            </button>
          ))}
        </div>
      </div>

      {isBrowsing && browsePageCount > 1 && (
        <div class="row justify-between">
          <small>
            Page {browsePage + 1} of {browsePageCount}
          </small>
          <div class="row">
            <button
              type="button"
              class="outline sm"
              disabled={browsePage === 0}
              onClick={() => setBrowsePage(browsePage - 1)}
            >
              <ArrowLeftIcon />
              Previous
            </button>
            <button
              type="button"
              class="outline sm"
              disabled={browsePage >= browsePageCount - 1}
              onClick={() => setBrowsePage(browsePage + 1)}
            >
              Next
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
