import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
const { path } = window.__DRY_CONFIG__;

import { useDialogSync } from "../components/list-nav.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { diffContentType } from "../content-types/draft-diff.js";
import { drafts as draftsSignal } from "../content-types/draft-store.js";
import { fieldTypes } from "../content-types/field-registry.js";
import type {
  ContentTypeDefinition,
  ContentTypeKind,
} from "../content-types/types.js";
import {
  fieldTypeColors,
  fieldTypeIcons,
} from "../components/field-type-icons.js";
import { PlusIcon, UploadIcon } from "../components/icons.js";
import { useFetch } from "../hooks/useFetch.js";
import { useParam } from "../hooks/useParam.js";
import { contentTypesVersion } from "../store/content-types.js";
import ContentTypeEditor from "./ContentTypeEditor.js";
import ApplyBuildDialog from "./content-type-editor/ApplyBuildDialog.js";
import { useDocumentTitle } from "./page-common.js";

function CollectionCard({
  definition,
  status,
  onOpen,
  onApply,
}: {
  definition: ContentTypeDefinition;
  status: { isNew: boolean; editedCount: number } | null;
  onOpen: (id: string) => void;
  onApply: (id: string) => void;
}) {
  const fields = definition.fields.filter(
    (field) => !(definition.deletedFieldIds ?? []).includes(field.id),
  );
  const featureCount = Object.values(definition.features ?? {}).filter(
    Boolean,
  ).length;

  const featureLabels = Object.entries(definition.features ?? {})
    .filter(([, enabled]) => enabled)
    .map(([feature]) => feature)
    .join(", ");

  return (
    <div
      class={`builder-collection-card${status?.isNew ? " new" : ""}${status?.editedCount ? " edited" : ""}`}
      onClick={() => onOpen(definition.id)}
    >
      <span class="builder-collection-card-header">
        <span class="builder-collection-card-title">
          <strong>
            {definition.label || definition.name || "Untitled collection"}
          </strong>
          <span class="hint">
            <span class="badge outline sm">
              {definition.name || "no-table-name"}
            </span>{" "}
            - {definition.description || "No description"}
          </span>
        </span>
        <span class="builder-collection-card-status">
          {status?.isNew && <span class="badge sm info">Draft</span>}
          {!!status && !status.isNew && status.editedCount > 0 && (
            <span class="badge sm warning">{status.editedCount} edited</span>
          )}
          <span
            data-tooltip={`Features: ${featureLabels}`}
            class="badge secondary"
          >
            {featureCount}
          </span>
        </span>
      </span>
      <span
        class="builder-collection-card-fields"
        aria-label="Collection fields"
      >
        {fields.length === 0 ? (
          <span class="hint">No custom fields yet</span>
        ) : (
          fields.map((field) => {
            const TypeIcon = fieldTypeIcons[field.type] ?? fieldTypeIcons.text!;
            const color = fieldTypeColors[field.type];
            return (
              <span
                class="builder-field-icon"
                style={color ? { "--field-type-color": color } : undefined}
                title={`${field.label || field.name} · ${fieldTypes[field.type]?.label ?? field.type}`}
                key={field.id}
              >
                <TypeIcon />
              </span>
            );
          })
        )}
      </span>
      {status && (
        <button
          type="button"
          class="outline sm builder-collection-card-apply"
          onClick={(event) => {
            event.stopPropagation();
            onApply(definition.id);
          }}
        >
          <UploadIcon /> Apply Builder
        </button>
      )}
    </div>
  );
}

const KIND_LABELS: Record<ContentTypeKind, string> = {
  collection: "Collection",
  singleton: "Singleton",
  component: "Component",
};
const KIND_PLURAL_LABELS: Record<ContentTypeKind, string> = {
  collection: "Collections",
  singleton: "Singletons",
  component: "Components",
};

function BuilderCollectionList({
  kind,
  search,
  onOpen,
  onApply,
  definitions,
  error,
}: {
  kind: ContentTypeKind;
  search: string;
  onOpen: (id: string) => void;
  onApply: (id: string) => void;
  definitions: ContentTypeDefinition[] | undefined;
  error: unknown;
}) {
  const pendingDrafts = draftsSignal.value;
  const liveDefinitions = (definitions ?? []).filter(
    (definition) => definition.kind === kind && !definition.hidden,
  );
  const collections = [
    ...liveDefinitions.map((definition) => {
      const draft = pendingDrafts[definition.id];
      return {
        definition: draft?.definition ?? definition,
        status: draft ? diffContentType(definition, draft.definition) : null,
      };
    }),
    ...Object.values(pendingDrafts)
      .filter(
        (draft) =>
          draft.isNew &&
          draft.definition.kind === kind &&
          !liveDefinitions.some(
            (definition) => definition.id === draft.definition.id,
          ),
      )
      .map((draft) => ({
        definition: draft.definition,
        status: diffContentType(undefined, draft.definition),
      })),
  ];

  if (error)
    return (
      <span class="error">
        {error instanceof Error ? error.message : "Failed to load collections."}
      </span>
    );
  if (!definitions)
    return (
      <div class="builder-collection-list-loading" aria-busy="true">
        Loading collections…
      </div>
    );
  if (collections.length === 0)
    return (
      <div class="builder-collection-list-empty">
        <strong>No {KIND_LABELS[kind].toLowerCase()}s yet</strong>
        <span class="hint">
          Click Add above to start building a {KIND_LABELS[kind].toLowerCase()}.
        </span>
      </div>
    );

  const query = search.trim().toLowerCase();
  const filtered = query
    ? collections.filter(({ definition }) =>
        [definition.label, definition.name, definition.description].some(
          (value) => value?.toLowerCase().includes(query),
        ),
      )
    : collections;

  if (filtered.length === 0)
    return (
      <div class="builder-collection-list-empty">
        <strong>No matches</strong>
        <span class="hint">Try a different search term.</span>
      </div>
    );

  return (
    <div class="builder-collection-list">
      {filtered.map((definition) => (
        <CollectionCard
          key={definition.definition.id}
          definition={definition.definition}
          status={definition.status}
          onOpen={onOpen}
          onApply={onApply}
        />
      ))}
    </div>
  );
}

function CollectionEditorDialog({
  id,
  addingKind,
  onClose,
}: {
  id: string | null;
  addingKind: ContentTypeKind | null;
  onClose: () => void;
}) {
  const open = id !== null || addingKind !== null;
  const dialogRef = useDialogSync(open, onClose);

  return (
    <dialog
      ref={dialogRef}
      class="xl builder-editor-dialog"
      aria-label={
        addingKind
          ? `Add ${KIND_LABELS[addingKind].toLowerCase()}`
          : "Edit collection"
      }
    >
      {open && (
        <ContentTypeEditor
          id={id ?? undefined}
          kind={addingKind ?? undefined}
          embedded
          onClose={onClose}
        />
      )}
    </dialog>
  );
}

export default function BuilderContentType() {
  useDocumentTitle("Content Types");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingKind, setAddingKind] = useState<ContentTypeKind | null>(null);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyBuilderId, setApplyBuilderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const api = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );
  const listFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) =>
      api.listVersioned(ifVersion, signal),
    [api],
  );
  const {
    data: definitions,
    error: definitionsError,
    reload,
  } = useFetch<ContentTypeDefinition[]>("content-types:list", listFetcher);
  const skipFirstVersionEffect = useRef(true);
  useEffect(() => {
    if (skipFirstVersionEffect.current) {
      skipFirstVersionEffect.current = false;
      return;
    }
    void reload();
  }, [contentTypesVersion.value, reload]);
  const pendingDrafts = draftsSignal.value;
  const pendingCount = Object.keys(pendingDrafts).length;
  const liveDefinitions = (definitions ?? []).filter(
    (definition) => !definition.hidden,
  );
  const [selectedKind, setSelectedKind] = useParam<ContentTypeKind>(
    "selectedKind",
    "collection",
  );

  const kindCounts = useMemo(() => {
    const counts: Record<ContentTypeKind, number> = {
      collection: 0,
      singleton: 0,
      component: 0,
    };
    for (const definition of liveDefinitions) counts[definition.kind]++;
    for (const draft of Object.values(pendingDrafts)) {
      if (
        draft.isNew &&
        !liveDefinitions.some((d) => d.id === draft.definition.id)
      ) {
        counts[draft.definition.kind]++;
      }
    }
    return counts;
  }, [liveDefinitions, pendingDrafts]);

  function openApplyDialog(id: string | null) {
    setApplyBuilderId(id);
    setApplyDialogOpen(true);
  }

  return (
    <>
      <div class="page-header">
        <div>
          <h1>Content Types</h1>
          <p>
            Define the shape of your content - Collections, Singletons, and
            Components.
          </p>
        </div>
        {pendingCount > 0 && (
          <button
            type="button"
            aria-busy={definitions ? false : true}
            disabled={!definitions}
            onClick={() => openApplyDialog(null)}
          >
            <UploadIcon /> Apply Builder
          </button>
        )}
      </div>

      <div class="builder-content-type-layout">
        <section class="card builder-panel">
          <header class="row justify-between">
            <div class="spacer">
              <h2>{KIND_PLURAL_LABELS[selectedKind]}</h2>
              <p>Choose a {KIND_LABELS[selectedKind].toLowerCase()} to edit.</p>
            </div>
            <div class="row" style={{ flexWrap: "nowrap" }}>
              <div
                class="file-view-toggle"
                role="group"
                aria-label="Content type kind"
              >
                {(Object.keys(KIND_LABELS) as ContentTypeKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    class="sm ghost"
                    aria-pressed={selectedKind === kind}
                    onClick={() => setSelectedKind(kind)}
                  >
                    {KIND_LABELS[kind]}
                    <span class="badge outline sm">{kindCounts[kind]}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                class="outline"
                onClick={() => setAddingKind(selectedKind)}
              >
                <PlusIcon /> Add
              </button>
            </div>
          </header>
          <div class="row builder-collections-toolbar">
            <input
              type="search"
              value={search}
              placeholder="e.g. blog_posts"
              aria-label="Search content types"
              onInput={(event) =>
                setSearch((event.currentTarget as HTMLInputElement).value)
              }
            />
          </div>
          <div class="builder-panel-body builder-collections-body">
            <BuilderCollectionList
              kind={selectedKind}
              search={search}
              onOpen={setEditingId}
              onApply={(id) => openApplyDialog(id)}
              definitions={definitions}
              error={definitionsError}
            />
          </div>
        </section>
      </div>
      <CollectionEditorDialog
        id={editingId}
        addingKind={addingKind}
        onClose={() => {
          setEditingId(null);
          setAddingKind(null);
        }}
      />
      <ApplyBuildDialog
        open={applyDialogOpen}
        contentTypeId={applyBuilderId ?? undefined}
        liveDefinitions={liveDefinitions}
        onClose={() => {
          setApplyDialogOpen(false);
          setApplyBuilderId(null);
        }}
        onApplied={() => void reload()}
      />
    </>
  );
}
