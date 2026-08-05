import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import SlugField from "../components/fields/SlugField.js";
import TextField from "../components/fields/TextField.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { bumpContentTypesVersion } from "../store/content-types.js";
import {
  discardDraft,
  drafts,
  getDraft,
  saveDraft,
} from "../content-types/draft-store.js";
import { randomUUID } from "../lib/uuid.js";
import type {
  RelationFieldConfig,
  RelationMirrorFieldConfig,
} from "../content-types/field-registry.js";
import {
  activeFields,
  effectiveFeatures,
  relationMirrorFieldsFor,
  SYSTEM_FIELD_IDS,
  type FieldSide,
} from "../content-types/system-fields.js";
import type {
  ContentTypeDefinition,
  ContentTypeFeatures,
  ContentTypeKind,
  FieldDefinition,
} from "../content-types/types.js";
import {
  ArrowLeftIcon,
  InfoCircleIcon,
  TrashIcon,
} from "../components/icons/index.js";
import FeaturesFieldset, {
  FEATURES_BY_KIND,
} from "./content-type-editor/FeaturesFieldset.js";
import FieldDialog from "./content-type-editor/FieldDialog.js";
import FieldsList, {
  type SystemFieldEntry,
} from "./content-type-editor/FieldsList.js";
import FieldTrashDialog from "./content-type-editor/FieldTrashDialog.js";
import { useDocumentTitle } from "./page-common.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";

interface Props {
  id?: string;
  kind?: string;
  /** Renders the same editor inside Builder's native dialog without changing
   * the parent route when Save/Cancel is pressed. */
  embedded?: boolean;
  onClose?: () => void;
}

/** Matches `BuilderContentType.tsx`'s nav wording ("Single", not "Singleton") -
 * shown next to the label so it's clear which of the 3 kinds is being
 * edited, since the label/table name alone don't say. */
const KIND_LABELS: Record<ContentTypeKind, string> = {
  collection: "Collection",
  singleton: "Single",
  component: "Component",
};

/** ID is a real column, baked directly into every generated `CREATE TABLE`
 * rather than going through `systemFieldsFor` - see that file's doc comment
 * - and can't be dragged/reordered/removed. It's never shown in this UI -
 * every content type implicitly has one, so listing it as a row is just
 * noise - even though the column itself still exists.
 * Title is bundled with Slug (turning `slug` on adds both, in that order) -
 * shown/dragged here as a single "Title & Slug" row (see `SystemFieldEntry.
 * groupedIds`), even though both remain separate real columns underneath.
 * Created at/Updated at are bundled the same way, as a single "Timestamps"
 * row, when `features.timestamps` is on.
 * Draft/Schedule/Timestamps are collection-only.
 * Trailing `relationmirror` rows come from `relationMirrorFieldsFor` - one
 * per OTHER content type's `relation` field that targets this one, entirely
 * auto-derived (never hand-added, see `field-registry.ts`'s
 * `relationMirrorFieldType`) - so they render exactly like a system row:
 * no click-to-edit, no Remove action, appearing/disappearing on their own as
 * relations elsewhere are added/removed/retargeted. */
function systemFieldsForUi(
  definition: ContentTypeDefinition,
  allTypes: ContentTypeDefinition[],
): SystemFieldEntry[] {
  if (definition.kind === "component") return [];
  const features = effectiveFeatures(definition);
  const items: SystemFieldEntry[] = [];
  if (features.slug) {
    items.push({
      id: SYSTEM_FIELD_IDS.slug,
      label: "Title & Slug",
      name: "title, slug",
      typeLabel: "Slug",
      type: "slug",
      groupedIds: [SYSTEM_FIELD_IDS.title, SYSTEM_FIELD_IDS.slug],
    });
  }
  if (features.seo) {
    items.push({
      id: SYSTEM_FIELD_IDS.seo,
      label: "SEO",
      name: "seo",
      typeLabel: "Component",
      type: "component",
    });
  }
  if (definition.kind === "collection") {
    if (features.draft) {
      items.push({
        id: SYSTEM_FIELD_IDS.draft,
        label: "Draft",
        name: "draft",
        typeLabel: "Boolean",
        type: "boolean",
      });
    }
    if (features.schedule) {
      items.push({
        id: SYSTEM_FIELD_IDS.schedule,
        label: "Schedule",
        name: "schedule",
        typeLabel: "Date",
        type: "date",
      });
    }
    if (features.timestamps) {
      items.push({
        id: SYSTEM_FIELD_IDS.createdAt,
        label: "Timestamps",
        name: "createdAt, updatedAt",
        typeLabel: "Date",
        type: "date",
        groupedIds: [SYSTEM_FIELD_IDS.createdAt, SYSTEM_FIELD_IDS.updatedAt],
      });
    }
  }
  for (const mirror of relationMirrorFieldsFor(definition, allTypes)) {
    const config = mirror.config as RelationMirrorFieldConfig;
    const sourceType = allTypes.find((t) => t.id === config.sourceTypeId);
    const sourceField =
      sourceType &&
      activeFields(sourceType).find((f) => f.id === config.sourceFieldId);
    items.push({
      id: mirror.id,
      label: mirror.label,
      name: mirror.name,
      typeLabel: "Relation Mirror",
      type: "relationmirror",
      description: definition.fieldDescriptions?.[mirror.id],
      mirror:
        sourceType && sourceField
          ? {
              sourceTypeId: sourceType.id,
              sourceTypeLabel: sourceType.label,
              sourceFieldId: sourceField.id,
              sourceFieldLabel: sourceField.label,
            }
          : undefined,
    });
  }
  return items;
}

export default function ContentTypeEditor({
  id,
  kind,
  embedded = false,
  onClose,
}: Props) {
  const { route } = useLocation();
  const api = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );
  // Whether this id exists on the server (a real, applied content type) -
  // `false` both for the `/new/:kind` route AND for a not-yet-applied draft
  // reopened through its own `/:id/edit` url (see the load effect below).
  // Starts from the simple `!id` guess so first render has something
  // reasonable, then gets corrected once `allTypes` is fetched.
  const [isNew, setIsNew] = useState(!id);

  const [definition, setDefinition] = useState<ContentTypeDefinition | null>(
    null,
  );
  const { ref: embeddedBody } = useOverlayScrollbars<HTMLDivElement>([
    embedded,
    !!definition,
  ]);
  // Draft-overlaid (relation/component pickers, mirror rows) - see the load
  // effect below. `liveTypes` is the raw, un-overlaid server list, kept
  // separately only so `handleDiscardDraft` can fall back to the true live
  // definition rather than re-reading its own now-discarded draft back out
  // of `allTypes`.
  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[]>([]);
  const [liveTypes, setLiveTypes] = useState<ContentTypeDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const [tableNameError, setTableNameError] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDefinition | null>(
    null,
  );

  // Mirror-row remove state - see `deleteMirrorSource`'s doc comment for why
  // removing a mirror row is a cross-type operation, not a local edit. Its
  // EDIT path reuses `fieldDialogOpen`/`editingField` above instead - see
  // `mirrorEntryToFieldDefinition`.
  const [pendingMirrorRemove, setPendingMirrorRemove] =
    useState<SystemFieldEntry | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTableName, setDeleteTableName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDiscardDraftConfirm, setShowDiscardDraftConfirm] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // Snapshot of `definition` right after load/creation, before any edits -
  // compared against the live value to detect unsaved changes so leaving
  // the page (Cancel, back link, browser navigation) can warn first.
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const isDirty =
    initialSnapshot !== null &&
    definition !== null &&
    JSON.stringify(definition) !== initialSnapshot;

  useEffect(() => {
    if (definition || loadError) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), 150);
    return () => clearTimeout(timer);
  }, [definition, loadError]);

  useEffect(() => {
    (async () => {
      try {
        const types = await api.list();
        let liveType: ContentTypeDefinition | undefined;
        let loaded: ContentTypeDefinition;

        if (id) {
          liveType = types.find((t) => t.id === id);
          const draftEntry = getDraft(id);
          if (draftEntry) {
            // Reopening a pending draft (whether it already exists on the
            // server or not) - the draft always wins over the live/server
            // copy, since it's the admin's most recent unapplied edit.
            loaded = draftEntry.definition;
          } else if (liveType) {
            loaded = liveType;
          } else {
            // No cached copy, no draft - either a stale/direct url, or the
            // list cache just hasn't caught up yet. `api.get` throws a real
            // 404 if it genuinely doesn't exist anywhere.
            loaded = await api.get(id);
            liveType = loaded;
          }
          // `hidden` types (role/aiKey) have no schema editor of
          // their own - only reachable here via a stale draft/id, since
          // `BuilderContentType.tsx`/`DryLayout.tsx` never link to one. Bounce back
          // rather than rendering a form whose Save the server will reject
          // anyway (see `routes/content-types.ts`'s `frozen` check).
          if (liveType?.hidden) {
            toast.add({
              type: "error",
              title: `"${liveType.label || liveType.name}" is managed on its own page, not here.`,
            });
            if (embedded) onClose?.();
            else route(`${path}/content-types?selectedKind=${liveType.kind}`);
            return;
          }
          setHasDraft(!!draftEntry);
        } else {
          const initialKind: ContentTypeKind =
            kind === "singleton" || kind === "component" ? kind : "collection";
          loaded = {
            id: randomUUID(),
            kind: initialKind,
            name: "",
            label: "",
            description: "",
            features: {},
            fields: [],
            version: 0,
          };
          setHasDraft(false);
        }

        // Every OTHER type's own pending draft (if any) is what the admin is
        // actually looking at right now in this same browser - overlay it so
        // relation/component pickers and mirror rows reflect the in-progress
        // schema, not whatever's still live on the server.
        setLiveTypes(types);
        const merged = types.map((t) => getDraft(t.id)?.definition ?? t);
        for (const entry of Object.values(drafts.value)) {
          if (!merged.some((t) => t.id === entry.definition.id))
            merged.push(entry.definition);
        }
        setAllTypes(merged);

        setIsNew(!liveType);
        setDefinition(loaded);
        setInitialSnapshot(JSON.stringify(loaded));
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load content type.",
        );
      }
    })();
  }, [id, kind]);

  useDocumentTitle(
    isNew
      ? "New content type"
      : definition?.label || definition?.name || "Edit content type",
  );

  // Browser-level navigation (back/forward, refresh, closing the tab) can't
  // be intercepted with a custom dialog - `beforeunload` only lets the
  // browser show its own native prompt, triggered by setting `returnValue`.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  /** In-app navigation away from the editor - confirms first when there are
   * unsaved changes, via the same `ConfirmDialog` pattern as every other
   * destructive action on this page. */
  function requestLeave(to: string) {
    if (isDirty) setLeaveTo(to);
    else if (embedded) onClose?.();
    else route(to);
  }

  // `hidden` types (the built-in `seo` component, plus role/aiKey
  // among collections) are excluded here - they're implementation details of
  // other system types or managed through their own dedicated page, not
  // meant to be picked as a relation target/re-usable field group on
  // user-authored content types. The field CURRENTLY being edited is the one
  // exception: if it already targets a hidden collection (e.g. `user`'s
  // built-in `roles` field, targeting `role`), that target still needs to
  // resolve to a real option or the Select would render blank.
  //
  // `collections` deliberately does NOT exclude the type being edited from
  // its own relation-`target` picker (unlike `components`, where excluding
  // self prevents infinite recursion - a component's fields get inlined). A
  // `relation` is just an id column/child-table row, not inlined, so it has
  // no such recursion risk - excluding it here previously made a
  // self-relation (e.g. `Employee.manager -> Employee`) impossible to even
  // configure through this editor.
  const editingRelationTarget =
    editingField?.type === "relation"
      ? (editingField.config as RelationFieldConfig).target
      : undefined;
  const dynamicOptions = useMemo(
    () => ({
      collections: allTypes
        .filter(
          (t) =>
            t.kind === "collection" &&
            (!t.hidden || t.id === editingRelationTarget),
        )
        .map((t) => ({ value: t.id, label: t.label })),
      components: allTypes
        .filter(
          (t) => t.kind === "component" && t.id !== definition?.id && !t.hidden,
        )
        .map((t) => ({ value: t.id, label: t.label })),
    }),
    [allTypes, definition?.id, editingRelationTarget],
  );

  // Keeps `order` an explicit mirror of each field's position in `fields[]` -
  // the array itself stays the real source of order; the server re-normalizes
  // this again unconditionally on save (`normalizeFieldOrder` in naming.ts),
  // this just keeps the in-editor draft consistent before that ever happens.
  function withNormalizedOrder(fields: FieldDefinition[]): FieldDefinition[] {
    return fields.map((field, index) => ({ ...field, order: index }));
  }

  // `fields` here is only ever the ACTIVE (non-trashed) ones - `FieldsList`
  // never renders/reorders a trashed field, so it never appears in what it
  // reports back. Trashed fields are appended back on unchanged, or this
  // would silently drop them from `d.fields` (and, with them, the real
  // column `tree.ts` needs to keep generating - see `deletedFieldIds`).
  function updateFields(fields: FieldDefinition[]) {
    setDefinition((d) => {
      if (!d) return d;
      const deletedIds = new Set(d.deletedFieldIds ?? []);
      const trashed = d.fields.filter((f) => deletedIds.has(f.id));
      return { ...d, fields: withNormalizedOrder([...fields, ...trashed]) };
    });
  }

  /** Clicking Remove on a NEW (never-saved) content type deletes for real -
   * there's no live column yet to protect. On an EXISTING one it's a soft
   * delete: the field stays in `fields[]` (so its column survives) and is
   * just hidden from the active list via `deletedFieldIds`, restorable from
   * the trash - see `types.ts`'s doc comment. */
  function removeField(fieldId: string) {
    setDefinition((d) => {
      if (!d) return d;
      // Safety net matching the server's `validateProtectedFields` (see
      // `naming.ts`) - `FieldsList` already hides Remove for these ids, so
      // this only matters if something else calls through directly.
      if (d.protectedFieldIds?.includes(fieldId)) return d;
      if (isNew) {
        return {
          ...d,
          fields: withNormalizedOrder(d.fields.filter((f) => f.id !== fieldId)),
        };
      }
      if (d.deletedFieldIds?.includes(fieldId)) return d;
      return { ...d, deletedFieldIds: [...(d.deletedFieldIds ?? []), fieldId] };
    });
  }

  function restoreField(fieldId: string) {
    setDefinition((d) =>
      d
        ? {
            ...d,
            deletedFieldIds: (d.deletedFieldIds ?? []).filter(
              (id) => id !== fieldId,
            ),
          }
        : d,
    );
  }

  /** Deletes a trashed field for real - the only path that actually splices
   * it out of `fields[]`, which is what makes `tree.ts` stop generating its
   * column (a real `DROP COLUMN` on the next save). */
  function purgeField(fieldId: string) {
    setDefinition((d) => {
      if (!d) return d;
      return {
        ...d,
        fields: withNormalizedOrder(d.fields.filter((f) => f.id !== fieldId)),
        deletedFieldIds: (d.deletedFieldIds ?? []).filter(
          (id) => id !== fieldId,
        ),
      };
    });
  }

  /** Mirrors `removeField`'s new-vs-existing split for `features` - turning a
   * feature off on a NEW content type just flips it, same as always; on an
   * EXISTING one it goes to the trash instead (`features[key]` deliberately
   * stays `true` so its column(s) survive - see `deletedFeatureKeys`'s doc
   * comment), restorable the same way a field is. Turning a trashed feature
   * back on through the checkbox is just a restore. */
  function setFeature(key: keyof ContentTypeFeatures, value: boolean) {
    setDefinition((d) => {
      if (!d) return d;
      if (isNew) {
        return { ...d, features: { ...d.features, [key]: value } };
      }
      const trashed = d.deletedFeatureKeys ?? [];
      if (value) {
        if (trashed.includes(key)) {
          return { ...d, deletedFeatureKeys: trashed.filter((k) => k !== key) };
        }
        return { ...d, features: { ...d.features, [key]: true } };
      }
      if (trashed.includes(key)) return d;
      return { ...d, deletedFeatureKeys: [...trashed, key] };
    });
  }

  function restoreFeature(key: keyof ContentTypeFeatures) {
    setDefinition((d) =>
      d
        ? {
            ...d,
            deletedFeatureKeys: (d.deletedFeatureKeys ?? []).filter(
              (k) => k !== key,
            ),
          }
        : d,
    );
  }

  /** Turns a trashed feature off for real - the only path that actually
   * flips `features[key]` to `false`, which is what makes `tree.ts` stop
   * generating its column(s) (a real `DROP COLUMN`/table drop on the next
   * save). */
  function purgeFeature(key: keyof ContentTypeFeatures) {
    setDefinition((d) => {
      if (!d) return d;
      return {
        ...d,
        features: { ...d.features, [key]: false },
        deletedFeatureKeys: (d.deletedFeatureKeys ?? []).filter(
          (k) => k !== key,
        ),
      };
    });
  }

  function handleFieldSave(field: FieldDefinition, side: FieldSide) {
    setDefinition((d) => {
      if (!d) return d;
      // A mirror row isn't a real field - `FieldDialog` only ever lets its
      // Description/Display side change (Label/Name/Type are locked, see
      // `FieldDialog.tsx`'s `isMirror`), so only persist those, through the
      // same self-healing per-id maps `fieldSides` already uses - never add
      // it to `fields[]`.
      if (field.type === "relationmirror") {
        return {
          ...d,
          fieldSides: { ...d.fieldSides, [field.id]: side },
          fieldDescriptions: {
            ...d.fieldDescriptions,
            [field.id]: field.description ?? "",
          },
        };
      }
      // Keyed by id (not `editingField`, which is only ever set while
      // EDITING) so this also covers `FieldDialog.tsx`'s archived-name-match
      // case: adding a field named/typed like an archived one reuses that
      // archived field's id (see its `archivedFields` doc comment), which
      // already exists in `d.fields` - so it's replaced in place, restored
      // from the archive below, rather than appended as a real duplicate.
      const existingIndex = d.fields.findIndex((f) => f.id === field.id);
      const fields =
        existingIndex >= 0
          ? d.fields.map((f, i) => (i === existingIndex ? field : f))
          : [...d.fields, field];
      return {
        ...d,
        fields: withNormalizedOrder(fields),
        fieldSides: { ...d.fieldSides, [field.id]: side },
        deletedFieldIds: (d.deletedFieldIds ?? []).filter(
          (id) => id !== field.id,
        ),
      };
    });
    setFieldDialogOpen(false);
  }

  /** Synthesizes a `FieldDefinition`-shaped draft for a mirror row so it can
   * open through the SAME `FieldDialog` a real field uses (not a separate,
   * bespoke UI) - `FieldDialog` locks Label/Name/Type for it (`isMirror`)
   * since none of those are real/editable, but Description and Display side
   * both round-trip through `handleFieldSave` above like any other field. */
  function mirrorEntryToFieldDefinition(
    entry: SystemFieldEntry,
  ): FieldDefinition {
    const mirror = entry.mirror!;
    return {
      id: entry.id,
      name: entry.name,
      label: entry.label,
      description: entry.description,
      type: "relationmirror",
      config: {
        sourceTypeId: mirror.sourceTypeId,
        sourceFieldId: mirror.sourceFieldId,
      } satisfies RelationMirrorFieldConfig,
      validation: {},
      order: 0,
    };
  }

  /** A mirror row isn't a real field on `definition` - it's a reflection of
   * a `relation` field declared on ANOTHER content type (`entry.mirror.
   * sourceTypeId`/`sourceFieldId`). The only way to make the relationship
   * itself go away is to remove that real field, on that OTHER type - so
   * this stages a draft for that SEPARATE `ContentTypeDefinition`,
   * independent of this page's own `definition`/Save button. Like every
   * other edit now, it only takes real effect once "Apply and build" runs
   * on the Content Types page (see `status/content-type-staged-apply.md`) -
   * no server call, no destructive-change confirmation here anymore, that
   * moved to the batch apply dialog. */
  function deleteMirrorSource(entry: SystemFieldEntry) {
    const mirror = entry.mirror;
    if (!mirror) return;
    const sourceType = allTypes.find((t) => t.id === mirror.sourceTypeId);
    if (!sourceType) {
      toast.add({
        type: "error",
        title: `"${mirror.sourceTypeLabel}" no longer exists.`,
      });
      setPendingMirrorRemove(null);
      return;
    }
    const updatedSource: ContentTypeDefinition = {
      ...sourceType,
      fields: withNormalizedOrder(
        sourceType.fields.filter((f) => f.id !== mirror.sourceFieldId),
      ),
    };
    saveDraft(updatedSource, getDraft(sourceType.id)?.isNew ?? false);
    setAllTypes((types) =>
      types.map((t) => (t.id === updatedSource.id ? updatedSource : t)),
    );
    // A self-relation mirrors back onto the SAME type currently open in this
    // editor - keep the on-screen draft in sync with what was just staged,
    // same as `allTypes` above, rather than leaving stale fields sitting in
    // local state until the next reload.
    if (definition && definition.id === updatedSource.id) {
      setDefinition(updatedSource);
      setInitialSnapshot(JSON.stringify(updatedSource));
    }
    setPendingMirrorRemove(null);
    toast.add({
      type: "success",
      title: `Staged removal of "${mirror.sourceFieldLabel}" from "${mirror.sourceTypeLabel}".`,
      description: "Use Apply and build on Content Types to make it live.",
    });
  }

  /** Writes `definition` to the local draft store (see `draft-store.ts`) -
   * no server call, no migration runs yet. Applying it for real is a
   * separate, explicit step on the Content Types list page ("Apply and
   * build"), which reviews every pending draft together and dry-runs the
   * combined migration before writing anything. */
  function handleSaveClick() {
    if (!definition) return;
    if (!definition.label.trim() || !definition.name.trim()) {
      setTableNameError("Table Name is required.");
      return;
    }
    setTableNameError(null);
    saveDraft(definition, isNew);
    setHasDraft(true);
    setInitialSnapshot(JSON.stringify(definition));
    toast.add({
      type: "success",
      title: `Saved draft for "${definition.label}".`,
      description:
        "Go to Content Types and use Apply and build to make it live.",
    });
    if (embedded) onClose?.();
    else route(`${path}/content-types?selectedKind=${definition.kind}`);
  }

  function handleDiscardDraft() {
    if (!definition) return;
    discardDraft(definition.id);
    setShowDiscardDraftConfirm(false);
    if (isNew) {
      // Never existed on the server - nothing to fall back to, just leave.
      if (embedded) onClose?.();
      else route(`${path}/content-types?selectedKind=${definition.kind}`);
      return;
    }
    const live = liveTypes.find((t) => t.id === definition.id) ?? definition;
    setDefinition(live);
    setInitialSnapshot(JSON.stringify(live));
    setHasDraft(false);
    toast.add({ type: "success", title: "Draft discarded." });
  }

  async function handleDelete() {
    if (!definition) return;
    if (definition.kind === "collection" && deleteTableName !== definition.name)
      return;
    setDeleting(true);
    try {
      await api.remove(definition.id);
      discardDraft(definition.id);
      setShowDeleteConfirm(false);
      toast.add({
        type: "success",
        title: `Deleted "${definition.label || definition.name}".`,
      });
      bumpContentTypesVersion();
      if (embedded) onClose?.();
      else route(`${path}/content-types?selectedKind=${definition.kind}`);
    } catch (error) {
      toast.add({
        type: "error",
        title: "Delete failed",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!definition && !showLoading) return null;
  if (!definition)
    return (
      <div class="empty">
        <progress class="circle" />
        <p>Loading content type...</p>
      </div>
    );

  // Back/Cancel return to the list on the tab matching this content type's
  // kind, rather than resetting to whichever tab `selectedKind` defaults to.

  const backTo = `${path}/content-types?selectedKind=${definition.kind}`;
  const renderActions = () => (
    <>
      <button
        type="button"
        class="outline"
        onClick={() => requestLeave(backTo)}
      >
        Cancel
      </button>
      {hasDraft && (
        <button
          type="button"
          class="outline"
          onClick={() => setShowDiscardDraftConfirm(true)}
        >
          Discard draft
        </button>
      )}
      <button type="button" disabled={!isDirty} onClick={handleSaveClick}>
        Save draft
      </button>
    </>
  );

  return (
    <>
      <header class={`page-header${embedded ? " builder-editor-header" : ""}`}>
        <button
          type="button"
          class="icon ghost"
          onClick={() => requestLeave(backTo)}
        >
          <ArrowLeftIcon />
        </button>
        <div style={{ flex: 1 }}>
          <h1>
            {isNew
              ? `New ${KIND_LABELS[definition.kind]}`
              : definition.label || definition.name}
          </h1>
          <p>
            {definition.kind === "component"
              ? "Reusable field group, embeddable in other content types."
              : "Define the fields, data types, and structure used to store content for this content type."}
          </p>
        </div>
        <div class="row">{!embedded && renderActions()}</div>
      </header>

      <div
        class={embedded ? "under builder-editor-body" : undefined}
        ref={embedded ? embeddedBody : undefined}
      >
        {hasDraft && (
          <div class="alert">
            <InfoCircleIcon />
            <h4>Unapplied draft</h4>
            <p>
              Changes are saved as a draft only - go to Content Types and use
              "Apply and build" to run the migration and make them live.
            </p>
          </div>
        )}

        <div class="content-type-editor-grid">
          <legend class="stack">
            <FieldsList
              systemEntries={systemFieldsForUi(definition, allTypes)}
              fields={activeFields(definition)}
              features={effectiveFeatures(definition)}
              protectedFieldIds={definition.protectedFieldIds}
              fieldOrder={definition.fieldOrder}
              type={KIND_LABELS[definition.kind]}
              name={definition.name}
              description={definition.description}
              onEdit={(field) => {
                setEditingField(field);
                setFieldDialogOpen(true);
              }}
              onRemove={removeField}
              onEditMirror={(entry) => {
                setEditingField(mirrorEntryToFieldDefinition(entry));
                setFieldDialogOpen(true);
              }}
              onRemoveMirror={setPendingMirrorRemove}
              onReorderFields={updateFields}
              onReorderAll={(order) =>
                setDefinition((d) => (d ? { ...d, fieldOrder: order } : d))
              }
              onAdd={() => {
                setEditingField(null);
                setFieldDialogOpen(true);
              }}
              showTrash={!isNew}
              trashCount={
                (definition.deletedFieldIds?.length ?? 0) +
                (definition.deletedFeatureKeys?.length ?? 0)
              }
              onOpenTrash={() => setTrashOpen(true)}
            />
          </legend>
          <div class="stack">
            <SlugField
              label="Table Name"
              slugLabel="Table"
              placeholder="e.g. Blog Posts"
              slugPlaceholder="e.g. blog_posts"
              value={definition.label}
              slug={definition.name}
              onChange={(label, name) => {
                setTableNameError(null);
                setDefinition((d) => (d ? { ...d, label, name } : d));
              }}
              required
              error={!!tableNameError}
              helperText={tableNameError ?? undefined}
            />
            <TextField
              label="Description"
              multiline
              placeholder="e.g. Articles published on the company blog"
              value={definition.description ?? ""}
              onChange={(v) =>
                setDefinition((d) => (d ? { ...d, description: v } : d))
              }
              helperText="Optional description for this content type, shown in the admin UI."
            />

            {definition.kind !== "component" && (
              <TextField
                label="Live Preview"
                placeholder={
                  definition.kind === "singleton"
                    ? "e.g. https://example.com/about"
                    : "e.g. https://example.com/posts/{slug}"
                }
                value={definition.livePreviewUrl ?? ""}
                onChange={(v) =>
                  setDefinition((d) => (d ? { ...d, livePreviewUrl: v } : d))
                }
                helperText="URL the entry editor will open for a live preview."
              />
            )}

            <FeaturesFieldset
              kind={definition.kind}
              features={effectiveFeatures(definition)}
              onChange={setFeature}
            />

            {!isNew && definition.locked && (
              <div class="content-type-editor-danger">
                <div>
                  <h2>Danger zone</h2>
                  <p>
                    This {definition.kind} can't be deleted - other built-in
                    functionality (login, permissions) depends on it existing.
                  </p>
                </div>
              </div>
            )}

            {!isNew && !definition.locked && (
              <div class="content-type-editor-danger">
                <div>
                  <h2>Danger zone</h2>
                  <p>
                    Delete this {definition.kind} and all of its data. This
                    cannot be undone.
                  </p>
                </div>
                <button
                  type="button"
                  class="destructive"
                  onClick={() => {
                    setDeleteTableName("");
                    setShowDeleteConfirm(true);
                  }}
                >
                  <TrashIcon /> Delete {definition.kind}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {embedded && (
        <footer class="builder-editor-footer row justify-end">
          {renderActions()}
        </footer>
      )}

      <FieldDialog
        open={fieldDialogOpen}
        editingField={editingField}
        readOnly={
          !!editingField &&
          !!definition.protectedFieldIds?.includes(editingField.id)
        }
        dynamicOptions={dynamicOptions}
        fieldSides={definition.fieldSides}
        archivedFields={definition.fields.filter((f) =>
          definition.deletedFieldIds?.includes(f.id),
        )}
        showSideToggle={definition.kind !== "component"}
        onCancel={() => setFieldDialogOpen(false)}
        onSave={handleFieldSave}
      />

      <FieldTrashDialog
        open={trashOpen}
        fields={definition.fields.filter((f) =>
          definition.deletedFieldIds?.includes(f.id),
        )}
        features={(definition.deletedFeatureKeys ?? []).map((key) => ({
          key,
          label:
            FEATURES_BY_KIND[definition.kind].find((f) => f.key === key)
              ?.label ?? key,
        }))}
        onClose={() => setTrashOpen(false)}
        onRestoreField={restoreField}
        onPurgeField={purgeField}
        onRestoreFeature={restoreFeature}
        onPurgeFeature={purgeFeature}
      />

      <ConfirmDialog
        open={pendingMirrorRemove !== null}
        title={`Remove "${pendingMirrorRemove?.mirror?.sourceFieldLabel ?? ""}"?`}
        message={
          <p>
            This stages removal of "
            {pendingMirrorRemove?.mirror?.sourceFieldLabel}" from "
            {pendingMirrorRemove?.mirror?.sourceTypeLabel}" as a draft -
            applying it later will drop its column/table, and any data in it.
          </p>
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingMirrorRemove) deleteMirrorSource(pendingMirrorRemove);
        }}
        onCancel={() => setPendingMirrorRemove(null)}
      />

      <ConfirmDialog
        open={showDiscardDraftConfirm}
        title="Discard this draft?"
        message={
          <p>
            This discards the unapplied draft for "
            {definition.label || definition.name}"
            {isNew ? "" : " and reverts back to the live version"}. This cannot
            be undone.
          </p>
        }
        confirmLabel="Discard draft"
        destructive
        onConfirm={handleDiscardDraft}
        onCancel={() => setShowDiscardDraftConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete "${definition.label || definition.name}"?`}
        message={
          <>
            <p>
              This permanently deletes the {definition.kind} and all of its
              data. This cannot be undone.
            </p>
            {definition.kind === "collection" && (
              <p style={{ marginTop: "1em" }}>
                <TextField
                  label="Confirm table name"
                  value={deleteTableName}
                  onChange={setDeleteTableName}
                  placeholder={definition.name}
                  helperText={`Type "${definition.name}" to confirm deletion.`}
                />
              </p>
            )}
          </>
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        confirmDisabled={
          definition.kind === "collection" &&
          deleteTableName !== definition.name
        }
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleteTableName("");
          setShowDeleteConfirm(false);
        }}
      />

      <ConfirmDialog
        open={leaveTo !== null}
        title="Discard unsaved changes?"
        message={
          <p>
            You have unsaved changes to this {definition.kind}. Leaving now will
            discard them.
          </p>
        }
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => {
          const to = leaveTo!;
          setLeaveTo(null);
          if (embedded) onClose?.();
          else route(to);
        }}
        onCancel={() => setLeaveTo(null)}
      />
    </>
  );
}
