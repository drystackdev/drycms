import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import ConfirmDialog from "../components/ConfirmDialog.js";
import DataTable from "../components/DataTable.js";
import Icon from "../components/Icon.js";
import type { IconName } from "../components/icons.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition, ContentTypeKind } from "../content-types/types.js";

const GROUPS: { kind: ContentTypeKind; label: string; icon: IconName }[] = [
  { kind: "collection", label: "Collection", icon: "Collection" },
  { kind: "singleton", label: "Single", icon: "Singleton" },
  { kind: "component", label: "Component", icon: "Component" },
];

interface Row extends Record<string, unknown> {
  id: string;
  label: string;
  description: string;
  fieldCount: number;
  def: ContentTypeDefinition;
}

export default function ContentTypes() {
  useEffect(() => {
    document.title = "Content Types";
  }, []);

  const { route } = useLocation();
  const api = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);

  const [definitions, setDefinitions] = useState<ContentTypeDefinition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<ContentTypeKind>("collection");
  const [pendingDelete, setPendingDelete] = useState<ContentTypeDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    try {
      setDefinitions(await api.list());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load content types.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows: Row[] = (definitions ?? [])
    .filter((d) => d.kind === selectedKind)
    .map((d) => ({ id: d.id, label: d.label, description: d.description ?? "", fieldCount: d.fields.length, def: d }));

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.remove(pendingDelete.id);
      toast.add({ type: "success", title: `Deleted "${pendingDelete.label}".` });
      setPendingDelete(null);
      await load();
    } catch (error) {
      toast.add({
        type: "error",
        title: "Delete failed",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  const selectedGroup = GROUPS.find((g) => g.kind === selectedKind)!;

  return (
    <>
      <div class="page-header">
        <div>
          <h1>Content Types</h1>
          <p>Define the shape of your content - Collections, Singles, and Components.</p>
        </div>
      </div>

      {loadError && <span class="error">{loadError}</span>}

      {definitions === null && !loadError ? (
        <span class="hint">Loading…</span>
      ) : (
        <div class="content-types-grid">
          <ul class="content-types-nav">
            {GROUPS.map(({ kind, label, icon }) => (
              <li key={kind}>
                <button
                  type="button"
                  aria-current={kind === selectedKind ? "page" : undefined}
                  onClick={() => setSelectedKind(kind)}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                </button>
              </li>
            ))}
          </ul>

          <div class="content-types-panel">
            <div class="row justify-between">
              <h3>{selectedGroup.label}</h3>
              <button
                type="button"
                class="outline sm"
                onClick={() => route(`${path}/content-types/new/${selectedKind}`)}
              >
                + Add
              </button>
            </div>
            <DataTable
              columns={[
                { key: "label", label: "Name", sortable: true },
                { key: "description", label: "Description", sortable: false },
                { key: "fieldCount", label: "Fields", numeric: true, sortable: true },
                {
                  key: "id",
                  label: "",
                  sortable: false,
                  render: (_value, row) => (
                    <button
                      type="button"
                      class="ghost sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDelete(row.def);
                      }}
                    >
                      Delete
                    </button>
                  ),
                },
              ]}
              rows={rows}
              emptyLabel="None yet."
              onRowClick={(row) => route(`${path}/content-types/${row.id}/edit`)}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.label ?? ""}"?`}
        message={
          <p>
            This drops the underlying table{pendingDelete?.kind === "component" ? "" : " and every row in it"} - this
            cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
