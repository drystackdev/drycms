import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import CheckField from "../components/fields/CheckField.js";
import Combobox, { type ComboboxOption } from "../components/Combobox.js";
import { ArrowLeftIcon, ArrowRightIcon } from "../components/icons/index.js";
import IconGlyph from "../components/IconGlyph.js";
import IconPreviewDialog from "../components/IconPreviewDialog.js";
import { toast } from "../components/Toast.js";
import {
  createIconifyApi,
  type IconifyCollection,
} from "../icons/iconify-http-api.js";
import { createIconsApi } from "../icons/icons-http-api.js";
import { ICON_MANAGEMENT_RESOURCE_ID } from "../content-types/permissions.js";
import { canAccess } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

const DEFAULT_PREFIX = "solar";
const SEARCH_LIMIT = 64;
const SEARCH_DEBOUNCE_MS = 300;
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
  const iconifyApi = useMemo(() => createIconifyApi(`${path}/api/iconify`), []);
  const iconsApi = useMemo(() => createIconsApi(`${path}/api/icons`), []);

  const [collections, setCollections] = useState<IconifyCollection[]>([]);
  const [category, setCategory] = useState(DEFAULT_PREFIX);
  const [searchAll, setSearchAll] = useState(false);
  const [query, setQuery] = useState("");
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The icon currently open in `IconPreviewDialog`, and whether its "Add" is
  // in flight.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  const handleAdd = () => {
    if (!previewId) return;
    const [prefix, name] = splitId(previewId);
    setAdding(true);
    iconsApi
      .importFromIconify({ prefix, names: [name] })
      .then((result) => {
        const added = result.created.length > 0;
        toast.add({
          type: added ? "success" : "warning",
          title: added ? `Added "${name}".` : `"${name}" already exists.`,
        });
        setPreviewId(null);
      })
      .catch((err) => {
        toast.add({
          type: "error",
          title: err instanceof Error ? err.message : "Failed to add icon.",
        });
      })
      .finally(() => setAdding(false));
  };

  if (!canAccess(ICON_MANAGEMENT_RESOURCE_ID, "setting")) {
    return <span class="error">You don't have permission to access Icon Management.</span>;
  }

  return (
    <div class="card">
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Add icon</h1>
          <p>Search Iconify and add icons to your library.</p>
        </div>
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

      <div class="under" style={{minHeight: 545}}>
        <div class="icon-grid">
          {displayIds.map((id) => (
            <button
              type="button"
              key={id}
              class="ghost icon-cell"
              disabled={!previews[id]}
              onClick={() => setPreviewId(id)}
              style={{
                height: "unset",
              }}
            >
              {previews[id] ? (
                <IconGlyph src={svgToDataUri(previews[id])} size={24} />
              ) : (
                <span class="skeleton" style="height: 1.5rem; width: 1.5rem; border-radius: 50%"></span>
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

      {previewId && previews[previewId] && (
        <IconPreviewDialog
          id={previewId}
          svg={previews[previewId]}
          adding={adding}
          onAdd={handleAdd}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}
