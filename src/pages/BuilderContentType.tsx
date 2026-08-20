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
import {
  drafts as draftsSignal,
  hydrateContentTypeDraftIndex,
  syncAiContentTypeDrafts,
  resolveAiDraftConflict,
  type AiDraftConflict,
} from "../content-types/draft-store.js";
import {
  SCHEMA_DOCUMENT_EXPORT_ENDPOINT,
  importSchemaDocument,
} from "../content-types/schema-document-http-api.js";
import { downloadBackup } from "../page-components/backup-http-api.js";
import { triggerDownload } from "../lib/download.js";
import { toast } from "../components/Toast.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { fieldTypes } from "../content-types/field-registry.js";
import { relationMirrorFieldsFor } from "../content-types/system-fields.js";
import type {
  ContentTypeDefinition,
  ContentTypeKind,
} from "../content-types/types.js";
import {
  fieldTypeColors,
  fieldTypeIcons,
} from "../components/fields/field-type-icons.js";
import { ExportIcon, PlusIcon, UploadIcon } from "../components/icons/index.js";
import { useFetch } from "../hooks/useFetch.js";
import { useParam } from "../hooks/useParam.js";
import { contentTypesVersion } from "../store/content-types.js";
import { CONTENT_TYPES_RESOURCE_ID } from "../content-types/permissions.js";
import { canAccess } from "../store/auth.js";
import ContentTypeEditor from "./ContentTypeEditor.js";
import ApplyBuildDialog from "./content-type-editor/ApplyBuildDialog.js";
import AiSchemaWizardPanel from "./content-type-editor/AiSchemaWizardPanel.js";
import { useDocumentTitle } from "./page-common.js";
import { temporaryFeatureVisibility } from "../lib/temporary-visibility.js";

/** How often this page re-checks the server for new/changed AI-proposed
 * content-type drafts while it's open - see the effect below for why plain
 * polling (not a push mechanism) is the deliberate choice here. */
const AI_DRAFT_POLL_MS = 25_000;

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
  allTypes,
  status,
  highlights,
  onOpen,
  onApply,
}: {
  definition: ContentTypeDefinition;
  /** Every OTHER content type (draft-overlaid, same as `ContentTypeEditor.tsx`'s
   * own `allTypes`) - needed to compute this type's auto-generated
   * `relationmirror` fields (`system-fields.ts`'s `relationMirrorFieldsFor`),
   * which never live in `definition.fields` themselves. */
  allTypes: ContentTypeDefinition[];
  status: { isNew: boolean; editedCount: number } | null;
  highlights: CardHighlights | null;
  onOpen: (id: string) => void;
  onApply: (id: string) => void;
}) {
  // Mirror fields appended after the real ones, same relative order the
  // schema editor's own Fields list uses (`ContentTypeEditor.tsx`'s
  // `systemFieldsForUi`) - a type with nothing but an incoming mirror still
  // has something to show here, not "No custom fields yet".
  const fields = [
    ...definition.fields.filter(
      (field) => !(definition.deletedFieldIds ?? []).includes(field.id),
    ),
    ...relationMirrorFieldsFor(definition, allTypes),
  ];
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
  // Every type (every kind, draft-overlaid), for `CollectionCard`'s mirror-
  // field computation - a relation field whose mirror shows up here can live
  // on any OTHER type, not just this `kind`'s own list, so this deliberately
  // doesn't reuse `liveDefinitions`' narrower filter. Same "draft wins, plus
  // not-yet-live new drafts" merge `ContentTypeEditor.tsx`'s own `allTypes`
  // load effect uses.
  const allTypesWithDrafts = [
    ...(definitions ?? []).map(
      (definition) => pendingDrafts[definition.id]?.definition ?? definition,
    ),
    ...Object.values(pendingDrafts)
      .filter(
        (draft) =>
          draft.isNew &&
          !(definitions ?? []).some((d) => d.id === draft.definition.id),
      )
      .map((draft) => draft.definition),
  ];
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
          allTypes={allTypesWithDrafts}
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
  /** Download/upload of `content/types.json` - the same pair the Backup page
   * offers, here because this is where someone actually works on the schema
   * (`status/content-types-json-file.md`). Upload only ever STAGES drafts;
   * "Apply Builder" is still what migrates a table. */
  const [downloadingJson, setDownloadingJson] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [pendingJsonImport, setPendingJsonImport] = useState<File | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
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

  // Pull any pending AI-proposed schema changes (MCP's `propose_content_type`)
  // into the local draft store - the same "Apply and build" review below
  // shows them alongside human-typed drafts, no separate screen. Re-synced
  // on an interval (not just on mount) so a proposal made WHILE this page is
  // already open still shows up without the admin having to navigate away
  // and back - deliberately plain polling rather than a push mechanism
  // (Durable Object/WebSocket): this notification has no real latency
  // requirement, and polling needs no new infrastructure and works
  // identically under both `kind: "local"` and `kind: "cloudflare"`. A
  // draft that conflicts with one already sitting here (different content,
  // same id) isn't silently overwritten - it's queued in `aiConflicts` for
  // the admin to resolve one at a time below, deduped by id so a later poll
  // never queues the same unresolved conflict twice.
  const [aiConflicts, setAiConflicts] = useState<AiDraftConflict[]>([]);
  const [aiDraftsSynced, setAiDraftsSynced] = useState(false);
  useEffect(() => {
    let cancelled = false;
    function pull() {
      void syncAiContentTypeDrafts().then((conflicts) => {
        if (cancelled) return;
        setAiDraftsSynced(true);
        if (conflicts.length === 0) return;
        setAiConflicts((current) => {
          const existingIds = new Set(current.map((entry) => entry.server.id));
          const fresh = conflicts.filter((entry) => !existingIds.has(entry.server.id));
          return fresh.length > 0 ? [...current, ...fresh] : current;
        });
      });
    }
    pull();
    const interval = setInterval(pull, AI_DRAFT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  const currentConflict = aiConflicts[0] ?? null;
  function resolveCurrentConflict(action: "overwrite" | "keep") {
    if (!currentConflict) return;
    void resolveAiDraftConflict(currentConflict, action);
    setAiConflicts((current) => current.slice(1));
  }
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

  // Deep link from an MCP `propose_content_type` tool response
  // (`routes/mcp.ts`'s `runProposeContentTypeTool`) - opens straight into
  // "Apply and build" for that one draft instead of leaving the admin to
  // find it in the list themselves. Waits for both the live schema and the
  // first AI-draft sync so the dialog's diff isn't computed against a
  // still-empty `liveDefinitions` or a not-yet-pulled draft, and only fires
  // once so a later `definitions`/`aiDraftsSynced` update can't reopen it
  // after the admin closes the dialog.
  const [openDraftId, setOpenDraftId] = useParam<string>("openDraft");
  const openedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (openedDeepLinkRef.current || !openDraftId || !definitions || !aiDraftsSynced) return;
    openedDeepLinkRef.current = true;
    openApplyDialog(openDraftId);
    setOpenDraftId(undefined);
  }, [openDraftId, definitions, aiDraftsSynced]);

  async function handleDownloadJson() {
    setDownloadingJson(true);
    try {
      const result = await downloadBackup(SCHEMA_DOCUMENT_EXPORT_ENDPOINT);
      if (!result.ok || !result.blob) {
        toast.add({ type: "error", title: "Export failed", description: result.reason });
        return;
      }
      triggerDownload(result.blob, result.filename ?? "drycms-content-types.json");
      toast.add({ type: "success", title: "Content types exported." });
    } finally {
      setDownloadingJson(false);
    }
  }

  function pickJsonImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared right away so picking the SAME file twice still fires `change`.
    input.value = "";
    if (file) setPendingJsonImport(file);
  }

  async function handleConfirmJsonImport() {
    if (!pendingJsonImport) return;
    setImportingJson(true);
    try {
      const result = await importSchemaDocument(pendingJsonImport);
      if (!result.ok) {
        toast.add({ type: "error", title: "Import failed", description: result.reason });
        return;
      }
      setPendingJsonImport(null);
      const staged = (result.added?.length ?? 0) + (result.updated?.length ?? 0);
      // This page renders `draftsSignal` directly, so the imported drafts
      // (and the "Apply Builder" button) appear as soon as it re-hydrates.
      await hydrateContentTypeDraftIndex();
      toast.add({
        type: staged > 0 ? "success" : "info",
        title: staged > 0 ? `${staged} content type${staged === 1 ? "" : "s"} staged as drafts` : "Nothing to stage",
        description:
          staged > 0
            ? `Review them here, then run "Apply Builder" to migrate. ${result.unchanged?.length ?? 0} already matched.`
            : "Every content type in that file already matches this project.",
      });
    } finally {
      setImportingJson(false);
    }
  }

  if (!canAccess(CONTENT_TYPES_RESOURCE_ID, "setting")) {
    return <span class="error">You don't have permission to access Content Types.</span>;
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
          <button
            type="button"
            class="outline"
            disabled={downloadingJson}
            aria-busy={downloadingJson || undefined}
            onClick={() => void handleDownloadJson()}
          >
            <ExportIcon /> Download JSON
          </button>
          <input
            ref={jsonFileInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={pickJsonImportFile}
          />
          <button type="button" class="outline" onClick={() => jsonFileInputRef.current?.click()}>
            <UploadIcon /> Upload JSON
          </button>
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
      <ConfirmDialog
        open={!!pendingJsonImport}
        title="Upload content types"
        busy={importingJson}
        confirmLabel="Stage as drafts"
        onConfirm={() => void handleConfirmJsonImport()}
        onCancel={() => {
          if (!importingJson) setPendingJsonImport(null);
        }}
        message={
          <p>
            Every content type in <strong>{pendingJsonImport?.name}</strong> is staged as a pending draft, replacing any draft
            already staged for the same type. No table is created, changed or dropped until you run "Apply Builder".
          </p>
        }
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
      <ConfirmDialog
        open={currentConflict !== null}
        title="AI proposed a conflicting change"
        message={
          <p>
            AI has proposed a change to "
            {currentConflict?.server.definition.label || currentConflict?.server.definition.name}
            " that's different from a draft you already have pending for it. Use the AI's
            version, or keep what you already have and discard the AI's proposal?
          </p>
        }
        confirmLabel="Use AI's version"
        cancelLabel="Keep my draft"
        onConfirm={() => resolveCurrentConflict("overwrite")}
        onCancel={() => resolveCurrentConflict("keep")}
      />
    </>
  );
}
