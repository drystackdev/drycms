import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import IconGlyph from "../components/IconGlyph.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PlusIcon,
} from "../components/icons/index.js";
import IconPreviewDialog from "../components/IconPreviewDialog.js";
import { createIconsApi, type IconEntry } from "../icons/icons-http-api.js";
import { useDocumentTitle } from "./page-common.js";

const PAGE_SIZE = 48;

export default function IconManagement() {
  useDocumentTitle("Icon Management");
  const { route } = useLocation();
  const iconsApi = useMemo(() => createIconsApi(`${path}/api/icons`), []);

  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<IconEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<IconEntry | null>(null);

  // Debounced: commits `searchInput` to `search` (the value actually sent to
  // the API) after a short pause, resetting to page 1 at the same time - a
  // new search term makes the old page number meaningless.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    iconsApi
      .list({ page, pageSize: PAGE_SIZE, search: search || undefined })
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setTotal(result.total);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : "Failed to load icons.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [iconsApi, page, search]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div class="card">
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Icon Management</h1>
          <p>
            Manage icons for the admin UI as .svg files, separate from the CMS's
            own icon set.
          </p>
        </div>
        <button
          type="button"
          class="outline"
          onClick={() => route(`${path}/icon-management/manual`)}
        >
          Add icon Manual
        </button>
        <button
          type="button"
          onClick={() => route(`${path}/icon-management/add`)}
        >
          <PlusIcon /> Add icon
        </button>
      </div>

      <div class="row" style={{ gap: "0.5rem" }}>
        <input
          type="search"
          value={searchInput}
          placeholder="Search icons by name…"
          aria-label="Search icons by name"
          style="max-width: 18rem"
          onInput={(event) =>
            setSearchInput((event.currentTarget as HTMLInputElement).value)
          }
        />
      </div>

      <div class="icon-grid under">
        {loadError && <span class="error">{loadError}</span>}
        {!loading && total === 0 && (
          <div class="empty">
            <span class="hint">
              {search ? "No icons match your search." : "No icons yet."}
            </span>
          </div>
        )}
        {entries.map((entry) => (
          <button
            type="button"
            class="ghost icon-cell"
            style={{ height: "unset" }}
            key={entry.id}
            onClick={() => setSelected(entry)}
          >
            <IconGlyph src={entry.url} size={24} />
            <small class="mono">{entry.name.replace(/\.svg$/, "")}</small>
          </button>
        ))}
      </div>

      {pageCount > 1 && (
        <div class="row justify-between">
          <small>
            Page {page + 1} of {pageCount}
          </small>
          <div class="row">
            <button
              type="button"
              class="outline sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ArrowLeftIcon />
              Previous
            </button>
            <button
              type="button"
              class="outline sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      )}

      {selected && (
        <IconPreviewDialog
          entry={selected}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null);
            setEntries((current) =>
              current.filter((e) => e.id !== selected.id),
            );
            setTotal((current) => current - 1);
          }}
        />
      )}
    </div>
  );
}
