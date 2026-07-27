import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import DataTable from "../components/DataTable.js";
import Icon from "../components/Icon.js";
import type { IconName } from "../components/icons.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type {
  ContentTypeDefinition,
  ContentTypeKind,
} from "../content-types/types.js";
import { useDocumentTitle } from "./page-common.js";
import CheckField from "../components/CheckField.js";
import { useStore } from "../hooks/useStore.js";

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
  system: boolean;
}

export default function ContentTypes() {
  useDocumentTitle("Content Types");

  const { route } = useLocation();
  const api = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );

  const [definitions, setDefinitions] = useState<
    ContentTypeDefinition[] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] =
    useState<ContentTypeKind>("collection");
  const [showSystemTypes, setShowSystemTypes] = useStore('showSystemTypes', true);

  useEffect(() => {
    (async () => {
      try {
        setDefinitions(await api.list());
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load content types.",
        );
      }
    })();
  }, []);

  const countByKind = (kind: ContentTypeKind) =>
    (definitions ?? []).filter((d) => d.kind === kind && (showSystemTypes || !d.system)).length;

  const rows: Row[] = (definitions ?? [])
    .filter((d) => d.kind === selectedKind && (showSystemTypes || !d.system))
    .map((d) => ({
      id: d.id,
      label: d.label,
      description: d.description ?? "",
      fieldCount: d.fields.length,
      system: !!d.system,
    }));

  const selectedGroup = GROUPS.find((g) => g.kind === selectedKind)!;

  return (
    <>
      <div class="page-header">
        <div>
          <h1>Content Types - {selectedGroup.label}</h1>
          <p>
            Define the shape of your content - Collections, Singles, and
            Components.
          </p>
        </div>
      </div>

      {loadError ? (
        <span class="error">{loadError}</span>
      ) : definitions === null ? (
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
                  <span class="spacer" />
                  <span class="badge outline">{countByKind(kind)}</span>
                </button>
              </li>
            ))}
            <li>
              <hr/>
            </li>
            <li>
              <CheckField
                role="switch"
                label="Show System Types"
                value={showSystemTypes}
                onChange={setShowSystemTypes}
                description="Show content types that are used internally by DryCMS."
              />
            </li>
          </ul>

          <div class="content-types-panel">
            <DataTable
              columns={[
                {
                  key: "label",
                  label: "Name",
                  sortable: true,
                  render: (_value, row) => (
                    <div class="stack" style={{ gap: "0.125rem" }}>
                      <span>
                        {row.label}
                        {row.system && (
                          <span class="badge sm outline" style={{ marginLeft: "0.5rem" }}>
                            System
                          </span>
                        )}
                      </span>
                      <span class="hint">
                        {row.description || <i>No description</i>}
                      </span>
                    </div>
                  ),
                },
                {
                  key: "fieldCount",
                  label: "Fields",
                  numeric: true,
                  sortable: true,
                  render: (_v, row) => <span class="badge outline">{row.fieldCount}</span>
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              emptyLabel="None yet."
              onRowClick={(row) =>
                route(`${path}/content-types/${row.id}/edit`)
              }
              actions={
                <button
                  type="button"
                  onClick={() =>
                    route(`${path}/content-types/new/${selectedKind}`)
                  }
                >
                  + Add {selectedGroup.label}
                </button>
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
