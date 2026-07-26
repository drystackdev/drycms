import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition, ContentTypeKind } from "../content-types/types.js";

const GROUPS: { kind: ContentTypeKind; label: string }[] = [
  { kind: "collection", label: "Collection" },
  { kind: "singleton", label: "Single" },
  { kind: "component", label: "Component" },
];

export default function ContentTypes() {
  useEffect(() => {
    document.title = "Content Types";
  }, []);

  const { route } = useLocation();
  const api = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);

  const [definitions, setDefinitions] = useState<ContentTypeDefinition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const groupItems = (kind: ContentTypeKind) => (definitions ?? []).filter((d) => d.kind === kind);

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
        GROUPS.map(({ kind, label }) => (
          <details key={kind} open>
            <summary>
              <span>{label}</span>
              <button
                type="button"
                class="outline sm"
                style={{marginLeft: 'auto'}}
                onClick={(event) => {
                  event.preventDefault();
                  route(`${path}/content-types/new/${kind}`);
                }}
              >
                + Add
              </button>
            </summary>
            <ul class="content-type-list">
              {groupItems(kind).length === 0 && <li class="hint">None yet.</li>}
              {groupItems(kind).map((def) => (
                <li key={def.id} class="content-type-list-item row justify-between" onClick={() => route(`${path}/content-types/${def.id}/edit`)}>
                  <span>{def.label}</span>
                  <div class="row">
                    <button type="button" class="ghost sm" onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(def)
                    }}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))
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
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
