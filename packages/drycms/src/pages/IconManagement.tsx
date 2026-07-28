import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import IconGlyph from "../components/IconGlyph.js";
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon } from "../components/icons.js";
import IconPreviewDialog from "../components/IconPreviewDialog.js";
import { createIconsApi, type IconEntry } from "../icons/icons-http-api.js";
import { useDocumentTitle } from "./page-common.js";

const PAGE_SIZE = 48;

export default function IconManagement() {
  useDocumentTitle("Icon Management");
  const { route } = useLocation();
  const iconsApi = useMemo(() => createIconsApi(`${path}/api/icons`), []);

  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<IconEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<IconEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    iconsApi
      .list({ page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setTotal(result.total);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load icons.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [iconsApi, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Icon Management</h1>
          <p>Manage icons for the admin UI as .svg files, separate from the CMS's own icon set.</p>
        </div>
        <button type="button" class="outline" onClick={() => route(`${path}/icon-management/manual`)}>
          Add icon Manual
        </button>
        <button type="button" onClick={() => route(`${path}/icon-management/add`)}>
          <PlusIcon /> Add icon
        </button>
      </div>

      {loadError && <span class="error">{loadError}</span>}
      {!loading && total === 0 && (
        <div class="empty">
          <span class="hint">No icons yet.</span>
        </div>
      )}

      <div class="icon-grid">
        {entries.map((entry) => (
          <button type="button" class="ghost icon-cell" key={entry.id} onClick={() => setSelected(entry)}>
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
            <button type="button" class="outline sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ArrowLeftIcon />
              Previous
            </button>
            <button type="button" class="outline sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
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
            setEntries((current) => current.filter((e) => e.id !== selected.id));
            setTotal((current) => current - 1);
          }}
        />
      )}
    </>
  );
}
