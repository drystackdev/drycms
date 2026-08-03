import { useCallback, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import DataTable from "../components/DataTable.js";
import Icon from "../components/Icon.js";
import { PlusIcon, UploadIcon, type IconName } from "../components/icons.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { diffContentType } from "../content-types/draft-diff.js";
import { drafts as draftsSignal } from "../content-types/draft-store.js";
import type {
  ContentTypeDefinition,
  ContentTypeKind,
} from "../content-types/types.js";
import { useFetch } from "../hooks/useFetch.js";
import { useDocumentTitle } from "./page-common.js";
import { useParam } from "../hooks/useParam.js";
import ApplyBuildDialog from "./content-type-editor/ApplyBuildDialog.js";

const GROUPS: { kind: ContentTypeKind; label: string; icon: IconName }[] = [
  { kind: "collection", label: "Collection", icon: "Collection" },
  { kind: "singleton", label: "Single", icon: "Singleton" },
  { kind: "component", label: "Component", icon: "Showcase" },
];

interface Row extends Record<string, unknown> {
  id: string;
  label: string;
  description: string;
  editedCount: number;
  hasDraft: boolean;
  isDraftOnly: boolean;
}

export default function ContentTypes() {
  useDocumentTitle("Content Types");

  const { route } = useLocation();
  const api = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );

  const [selectedKind, setSelectedKind] = useParam<ContentTypeKind>(
    "selectedKind",
    "collection",
  );
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyBuilderId, setApplyBuilderId] = useState<string | null>(null);

  const listFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) => api.listVersioned(ifVersion, signal),
    [api],
  );
  const { data: definitions, error, reload } = useFetch<ContentTypeDefinition[]>("content-types:list", listFetcher);
  const loadError = error ? (error instanceof Error ? error.message : "Failed to load content types.") : null;

  // `hidden` types (role/aiKey, plus the `seo` component) are
  // reached through their own dedicated page instead - see `types.ts`'s doc
  // comment on `ContentTypeDefinition.hidden`.
  const visibleDefinitions = (definitions ?? []).filter((d) => !d.hidden);

  // Every pending, unapplied edit (see `draft-store.ts`) - `@preact/signals`
  // re-renders this page whenever a draft is saved/discarded, including from
  // `ContentTypeEditor.tsx` on a DIFFERENT page visit, without any extra
  // wiring.
  const pendingDrafts = draftsSignal.value;
  const pendingList = Object.values(pendingDrafts);

  const countByKind = (kind: ContentTypeKind) =>
    visibleDefinitions.filter((d) => d.kind === kind).length;

  // A not-yet-created draft (`isNew`) has no row of its own in `definitions`
  // yet, so it's synthesized here; an existing type's pending draft instead
  // overlays that type's own row below (its "Edited" badge), same row.
  const newDraftRows: Row[] = pendingList
    .filter((entry) => entry.isNew && entry.definition.kind === selectedKind)
    .map((entry) => ({
      id: entry.definition.id,
      label: entry.definition.label || entry.definition.name || "(untitled)",
          description: entry.definition.description ?? "",
          editedCount: diffContentType(undefined, entry.definition).editedCount,
      hasDraft: true,
      isDraftOnly: true,
    }));

  const rows: Row[] = [
    ...visibleDefinitions
      .filter((d) => d.kind === selectedKind)
      .map((d): Row => {
        const draft = pendingDrafts[d.id];
        return {
          id: d.id,
          label: d.label,
          description: d.description ?? "",
          editedCount: draft ? diffContentType(d, draft.definition).editedCount : 0,
          hasDraft: !!draft,
          isDraftOnly: false,
        };
      }),
    ...newDraftRows,
  ];

  const selectedGroup = GROUPS.find((g) => g.kind === selectedKind)!;

  // Across ALL kinds at once, not just the selected tab - "Apply and build"
  // reviews and applies everything pending in one dialog/request (see
  // `status/content-type-staged-apply.md`).
  const pendingCount = pendingList.length;

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
      ) : (
        <div class="content-types-grid">
          <div class="content-types-panel">
            <DataTable
              columns={[
                {
                  key: "label",
                  label: "Name",
                  sortable: true,
                  render: (_value, row) => (
                    <div class="stack" style={{ gap: "0.125rem" }}>
                      <span class="row" style={{ gap: "0.375rem" }}>
                        {row.label}
                        {row.isDraftOnly && <span class="badge sm info">Draft</span>}
                      </span>
                      <span class="hint">
                        {row.description || <i>No description</i>}
                      </span>
                    </div>
                  ),
                },
                {
                  key: "editedCount",
                  label: "Edited",
                  numeric: true,
                  sortable: true,
                  render: (_v, row) => (
                    <span class={`badge ${row.editedCount > 0 ? "warning" : "outline"}`}>
                      {row.editedCount}
                    </span>
                  ),
                },
                {
                  key: "applyBuilder",
                  label: "Actions",
                  sortable: false,
                  render: (_value, row) =>
                    row.hasDraft ? (
                      <button
                        type="button"
                        class="outline sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setApplyBuilderId(row.id);
                          setApplyDialogOpen(true);
                        }}
                      >
                        <UploadIcon /> Apply Builder
                      </button>
                    ) : (
                      <span aria-hidden="true" />
                    ),
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
                  aria-busy={definitions ? false : true}
                  disabled={!definitions}
                  type="button"
                  onClick={() =>
                    route(`${path}/content-types/new/${selectedKind}`)
                  }
                >
                  <PlusIcon /> Add {selectedGroup.label}
                </button>
              }
            />
          </div>
          <div class="stack">
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
            </ul>

            {pendingCount > 0 && (
              <div class="content-types-apply-block">
                <h3>Unapplied changes</h3>
                <p>
                  {pendingCount} content type{pendingCount === 1 ? "" : "s"}{" "}
                  {pendingCount === 1 ? "has" : "have"} draft changes waiting
                  to be applied.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setApplyBuilderId(null);
                    setApplyDialogOpen(true);
                  }}
                >
                  <UploadIcon /> Apply and build
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <ApplyBuildDialog
        open={applyDialogOpen}
        contentTypeId={applyBuilderId ?? undefined}
        liveDefinitions={visibleDefinitions}
        onClose={() => {
          setApplyDialogOpen(false);
          setApplyBuilderId(null);
        }}
        onApplied={() => void reload()}
      />
    </>
  );
}
