import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { ComponentChildren } from "preact";
import fuzzysort from "fuzzysort";
const { path } = window.__DRY_CONFIG__;

import { useDialogSync } from "../hooks/list-nav.js";
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
} from "../components/fields/field-type-icons.js";
import { PlusIcon, UploadIcon } from "../components/icons/index.js";
import { useFetch } from "../hooks/useFetch.js";
import { useParam } from "../hooks/useParam.js";
import { contentTypesVersion } from "../store/content-types.js";
import ContentTypeEditor from "./ContentTypeEditor.js";
import ApplyBuildDialog from "./content-type-editor/ApplyBuildDialog.js";
import AiSchemaWizardPanel from "./content-type-editor/AiSchemaWizardPanel.js";
import { useDocumentTitle } from "./page-common.js";
import { temporaryFeatureVisibility } from "../lib/temporary-visibility.js";

interface CardHighlights {
  label: ComponentChildren;
  name: ComponentChildren;
  description: ComponentChildren;
}

/** `result.score` is 0 when this particular key had no match (an empty
 * field, or one the query just didn't hit) - fuzzysort's own `.highlight()`
 * would render as empty in that case since it only knows the ''-prepared
 * placeholder, not the real field text, so it falls back to `fallback`
 * (the untouched original string) instead. */
function highlightOrPlain(
  result: Fuzzysort.Result | undefined,
  fallback: string,
): ComponentChildren {
  if (!result || result.score <= 0) return fallback;
  return result.highlight((match, i) => (
    <mark key={i}>{match}</mark>
  )) as ComponentChildren;
}

function CollectionCard({
  definition,
  status,
  highlights,
  onOpen,
  onApply,
}: {
  definition: ContentTypeDefinition;
  status: { isNew: boolean; editedCount: number } | null;
  highlights: CardHighlights | null;
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
      class={`builder-collection-card${status?.isNew ? " new" : status?.editedCount ? " edited" : ""}`}
      onClick={() => onOpen(definition.id)}
    >
      <span class="builder-collection-card-header">
        <span class="builder-collection-card-title">
          <strong>
            {highlights?.label ??
              (definition.label || definition.name || "Untitled collection")}
          </strong>
          <span class="hint">
            <span class="badge outline sm">
              {highlights?.name ?? (definition.name || "no-table-name")}
            </span>{" "}
            -{" "}
            {highlights?.description ??
              (definition.description || "No description")}
          </span>
        </span>
        <span class="builder-collection-card-status">
          {status?.isNew && <span class="badge sm warning">New</span>}
          {!!status && !status.isNew && status.editedCount > 0 && (
            <span class="badge sm info">{status.editedCount} Edited</span>
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

const VISIBLE_KINDS: ContentTypeKind[] = temporaryFeatureVisibility.contentTypeComponents
  ? ["collection", "singleton", "component"]
  : ["collection", "singleton"];

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

  const query = search.trim();
  const filtered: Array<{
    definition: ContentTypeDefinition;
    status: { isNew: boolean; editedCount: number } | null;
    highlights: CardHighlights | null;
  }> = query
    ? fuzzysort
        .go(query, collections, {
          keys: [
            "definition.label",
            "definition.name",
            "definition.description",
          ],
          threshold: -10000,
        })
        .map((result) => {
          const { definition } = result.obj;
          return {
            definition,
            status: result.obj.status,
            highlights: {
              label: highlightOrPlain(
                result[0],
                definition.label || definition.name || "Untitled collection",
              ),
              name: highlightOrPlain(
                result[1],
                definition.name || "no-table-name",
              ),
              description: highlightOrPlain(
                result[2],
                definition.description || "No description",
              ),
            },
          };
        })
    : collections.map((entry) => ({ ...entry, highlights: null }));

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
          highlights={definition.highlights}
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
  const [requestedKind, setRequestedKind] = useParam<ContentTypeKind>(
    "selectedKind",
    "collection",
  );
  const selectedKind = VISIBLE_KINDS.includes(requestedKind)
    ? requestedKind
    : "collection";

  useEffect(() => {
    if (requestedKind !== selectedKind) setRequestedKind(selectedKind);
  }, [requestedKind, selectedKind, setRequestedKind]);

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
        <div class="row">
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
      </div>

      <div class="builder-content-type-layout">
        <section class="card builder-panel" id="builder-collections-panel">
          <header class="row justify-between">
            <div class="spacer">
              <h2>{KIND_PLURAL_LABELS[selectedKind]}</h2>
              <p>Choose a {KIND_LABELS[selectedKind].toLowerCase()} to edit.</p>
            </div>
            <div
              class="file-view-toggle"
              role="group"
              aria-label="Content type kind"
            >
              {VISIBLE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  class="sm ghost"
                  aria-pressed={selectedKind === kind}
                  onClick={() => setRequestedKind(kind)}
                >
                  {KIND_LABELS[kind]}
                  <span class="badge outline sm">{kindCounts[kind]}</span>
                </button>
              ))}
            </div>
          </header>
          <div
            class="row builder-collections-toolbar"
            style={{ flexWrap: "nowrap", justifyContent: "space-between" }}
          >
            <input
              type="search"
              value={search}
              placeholder="e.g. blog_posts"
              aria-label="Search content types"
              onInput={(event) =>
                setSearch((event.currentTarget as HTMLInputElement).value)
              }
            />
            <button
              type="button"
              class="outline"
              onClick={() => setAddingKind(selectedKind)}
            >
              <PlusIcon /> Add
            </button>
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
      <AiSchemaWizardPanel allDefinitions={definitions ?? []} />
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
