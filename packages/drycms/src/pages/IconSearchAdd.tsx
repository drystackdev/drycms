import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import CheckField from "../components/CheckField.js";
import Select, { type SelectOption } from "../components/Select.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import { createIconifyApi, type IconifyCollection } from "../icons/iconify-http-api.js";
import { createIconsApi } from "../icons/icons-http-api.js";
import { useDocumentTitle } from "./page-common.js";

const DEFAULT_PREFIX = "solar";
const SEARCH_LIMIT = 64;
const SEARCH_DEBOUNCE_MS = 300;

/** A percent-encoded (not base64) SVG data URI - simpler and more robust
 * than `btoa`, which throws on anything outside Latin1. Same "always render
 * as an <img>, never dangerouslySetInnerHTML" rule as the rest of this
 * feature applies here too, even though these are only-just-fetched
 * previews of icons that haven't been saved yet. */
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

  useEffect(() => {
    iconifyApi.collections().then(setCollections).catch(() => {
      // Non-fatal: the Select just falls back to the default "solar" option below.
    });
  }, [iconifyApi]);

  const collectionOptions: SelectOption[] = useMemo(() => {
    const known = collections.some((c) => c.prefix === DEFAULT_PREFIX);
    const base = known ? collections : [{ prefix: DEFAULT_PREFIX, name: "Solar" }, ...collections];
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
        .search({ query, prefixes: searchAll ? undefined : [category], limit: SEARCH_LIMIT })
        .then((result) => {
          setResultIds(result.icons);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Search failed."))
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [iconifyApi, query, category, searchAll]);

  // Fetches previews for whichever result ids aren't already cached -
  // `previews` is deliberately excluded from the deps below (read only to
  // compute `missing`, not to retrigger this effect on every fetch).
  useEffect(() => {
    const missing = resultIds.filter((id) => !(id in previews));
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
  }, [resultIds, iconifyApi]);

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
      [...namesByPrefix.entries()].map(([prefix, names]) => iconsApi.importFromIconify({ prefix, names })),
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
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Add icon</h1>
          <p>Search Iconify and add icons to your library.</p>
        </div>
      </div>

      <div class="row" style={{ gap: "1rem", alignItems: "flex-end" }}>
        <TextField
          label="Search"
          value={query}
          onChange={setQuery}
          placeholder="e.g. home, arrow, user"
          style={{ flex: 1 }}
        />
        <Select
          options={collectionOptions}
          value={category}
          onChange={setCategory}
          disabled={searchAll}
          placeholder="Icon set"
        />
        <CheckField value={searchAll} onChange={setSearchAll} label="Search all icon sets" role="switch" />
      </div>

      {error && <span class="error">{error}</span>}
      {searching && <span class="hint">Searching…</span>}
      {!searching && query.trim() && resultIds.length === 0 && <span class="hint">No results.</span>}

      <div class="icon-grid">
        {resultIds.map((id) => (
          <button
            type="button"
            key={id}
            class={'ghost ' + (selected.has(id) ? "icon-cell selected" : "icon-cell")}
            onClick={() => toggleSelect(id)}
            style={{
              height: 'unset'
            }}
          >
            {previews[id] ? (
              <img src={svgToDataUri(previews[id])} alt="" width={24} height={24} />
            ) : (
              <div class="center">
                <progress class="circle"/>
              </div>
            )}
            <small class="mono">{splitId(id)[1]}</small>
          </button>
        ))}
      </div>

      <div class="row justify-end">
        <button type="button" class="outline" onClick={() => route(`${path}/icon-management`)}>
          Cancel
        </button>
        <button type="button" disabled={selected.size === 0 || importing} onClick={handleAdd}>
          Add [{selected.size}]
        </button>
      </div>
    </>
  );
}
