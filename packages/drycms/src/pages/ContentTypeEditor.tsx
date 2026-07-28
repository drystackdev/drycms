import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import ConfirmDialog from "../components/ConfirmDialog.js";
import SlugField from "../components/SlugField.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { randomUUID } from "../lib/uuid.js";
import type { RelationMirrorFieldConfig } from "../content-types/field-registry.js";
import type { DestructiveChange } from "../content-types/migration.js";
import {
  relationMirrorFieldsFor,
  SYSTEM_FIELD_IDS,
  type FieldSide,
} from "../content-types/system-fields.js";
import type {
  ContentTypeDefinition,
  ContentTypeKind,
  FieldDefinition,
} from "../content-types/types.js";
import { ArrowLeftIcon, TrashIcon } from "../components/icons.js";
import FeaturesFieldset from "./content-type-editor/FeaturesFieldset.js";
import FieldDialog from "./content-type-editor/FieldDialog.js";
import FieldsList, {
  type SystemFieldEntry,
} from "./content-type-editor/FieldsList.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  id?: string;
  kind?: string;
}

/** Matches `ContentTypes.tsx`'s nav wording ("Single", not "Singleton") -
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
  const items: SystemFieldEntry[] = [];
  if (definition.features?.slug) {
    items.push({
      id: SYSTEM_FIELD_IDS.slug,
      label: "Title & Slug",
      name: "title, slug",
      typeLabel: "Slug",
      groupedIds: [SYSTEM_FIELD_IDS.title, SYSTEM_FIELD_IDS.slug],
    });
  }
  if (definition.features?.seo) {
    items.push({
      id: SYSTEM_FIELD_IDS.seo,
      label: "SEO",
      name: "seo",
      typeLabel: "Component",
    });
  }
  if (definition.kind === "collection") {
    if (definition.features?.draft) {
      items.push({
        id: SYSTEM_FIELD_IDS.draft,
        label: "Draft",
        name: "draft",
        typeLabel: "Boolean",
      });
    }
    if (definition.features?.schedule) {
      items.push({
        id: SYSTEM_FIELD_IDS.schedule,
        label: "Schedule",
        name: "schedule",
        typeLabel: "Date",
      });
    }
    if (definition.features?.timestamps) {
      items.push({
        id: SYSTEM_FIELD_IDS.createdAt,
        label: "Timestamps",
        name: "createdAt, updatedAt",
        typeLabel: "Date",
        groupedIds: [SYSTEM_FIELD_IDS.createdAt, SYSTEM_FIELD_IDS.updatedAt],
      });
    }
  }
  for (const mirror of relationMirrorFieldsFor(definition, allTypes)) {
    const config = mirror.config as RelationMirrorFieldConfig;
    const sourceType = allTypes.find((t) => t.id === config.sourceTypeId);
    const sourceField = sourceType?.fields.find((f) => f.id === config.sourceFieldId);
    items.push({
      id: mirror.id,
      label: mirror.label,
      name: mirror.name,
      typeLabel: "Relation Mirror",
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

export default function ContentTypeEditor({ id, kind }: Props) {
  const { route } = useLocation();
  const api = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );
  const isNew = !id;

  const [definition, setDefinition] = useState<ContentTypeDefinition | null>(
    null,
  );
  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tableNameError, setTableNameError] = useState<string | null>(null);

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
  const [mirrorDestructiveSummary, setMirrorDestructiveSummary] = useState<
    DestructiveChange[] | null
  >(null);
  const [mirrorRemoving, setMirrorRemoving] = useState(false);

  const [pendingConfirm, setPendingConfirm] = useState<
    DestructiveChange[] | null
  >(null);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    (async () => {
      try {
        const types = await api.list();
        setAllTypes(types);
        let loaded: ContentTypeDefinition;
        if (id) {
          loaded = types.find((t) => t.id === id) ?? (await api.get(id));
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
        }
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
    else route(to);
  }

  // System components (e.g. the built-in `seo` component) are excluded here -
  // they're implementation details of other system types, not meant to be
  // picked as a re-usable field group on user-authored content types.
  //
  // `collections` deliberately does NOT exclude the type being edited from
  // its own relation-`target` picker (unlike `components`, where excluding
  // self prevents infinite recursion - a component's fields get inlined). A
  // `relation` is just an id column/child-table row, not inlined, so it has
  // no such recursion risk - excluding it here previously made a
  // self-relation (e.g. `Employee.manager -> Employee`) impossible to even
  // configure through this editor.
  const dynamicOptions = useMemo(
    () => ({
      collections: allTypes
        .filter((t) => t.kind === "collection")
        .map((t) => ({ value: t.id, label: t.label })),
      components: allTypes
        .filter(
          (t) => t.kind === "component" && t.id !== definition?.id && !t.system,
        )
        .map((t) => ({ value: t.id, label: t.label })),
    }),
    [allTypes, definition?.id],
  );

  // Keeps `order` an explicit mirror of each field's position in `fields[]` -
  // the array itself stays the real source of order; the server re-normalizes
  // this again unconditionally on save (`normalizeFieldOrder` in naming.ts),
  // this just keeps the in-editor draft consistent before that ever happens.
  function withNormalizedOrder(fields: FieldDefinition[]): FieldDefinition[] {
    return fields.map((field, index) => ({ ...field, order: index }));
  }

  function updateFields(fields: FieldDefinition[]) {
    setDefinition((d) =>
      d ? { ...d, fields: withNormalizedOrder(fields) } : d,
    );
  }

  function removeField(fieldId: string) {
    setDefinition((d) => {
      if (!d) return d;
      return {
        ...d,
        fields: withNormalizedOrder(d.fields.filter((f) => f.id !== fieldId)),
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
          fieldDescriptions: { ...d.fieldDescriptions, [field.id]: field.description ?? "" },
        };
      }
      const fields = editingField
        ? d.fields.map((f) => (f.id === editingField.id ? field : f))
        : [...d.fields, field];
      return {
        ...d,
        fields: withNormalizedOrder(fields),
        fieldSides: { ...d.fieldSides, [field.id]: side },
      };
    });
    setFieldDialogOpen(false);
  }

  /** Synthesizes a `FieldDefinition`-shaped draft for a mirror row so it can
   * open through the SAME `FieldDialog` a real field uses (not a separate,
   * bespoke UI) - `FieldDialog` locks Label/Name/Type for it (`isMirror`)
   * since none of those are real/editable, but Description and Display side
   * both round-trip through `handleFieldSave` above like any other field. */
  function mirrorEntryToFieldDefinition(entry: SystemFieldEntry): FieldDefinition {
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
   * this saves a SEPARATE `ContentTypeDefinition` through the same API,
   * independent of this page's own `definition`/`submit`. Reuses the
   * server's normal destructive-change confirmation (`requiresConfirm`) -
   * dropping a `relation` field can drop a real column/child-table. */
  async function deleteMirrorSource(entry: SystemFieldEntry, confirm: boolean) {
    const mirror = entry.mirror;
    if (!mirror) return;
    const sourceType = allTypes.find((t) => t.id === mirror.sourceTypeId);
    if (!sourceType) {
      toast.add({ type: "error", title: `"${mirror.sourceTypeLabel}" no longer exists.` });
      setPendingMirrorRemove(null);
      return;
    }
    const updatedSource: ContentTypeDefinition = {
      ...sourceType,
      fields: withNormalizedOrder(
        sourceType.fields.filter((f) => f.id !== mirror.sourceFieldId),
      ),
    };
    setMirrorRemoving(true);
    try {
      const response = await api.update(updatedSource, confirm);
      if (response.requiresConfirm) {
        setMirrorDestructiveSummary(response.destructiveSummary ?? []);
        return;
      }
      const saved = response.definition ?? updatedSource;
      setAllTypes((types) => types.map((t) => (t.id === saved.id ? saved : t)));
      // A self-relation mirrors back onto the SAME type currently open in
      // this editor - keep its own draft in sync with what the server just
      // saved, same as `allTypes` above, rather than leaving stale fields
      // sitting in local state until the next reload.
      if (definition && definition.id === saved.id) {
        setDefinition(saved);
        setInitialSnapshot(JSON.stringify(saved));
      }
      setMirrorDestructiveSummary(null);
      setPendingMirrorRemove(null);
      toast.add({
        type: "success",
        title: `Removed "${mirror.sourceFieldLabel}" from "${mirror.sourceTypeLabel}".`,
      });
    } catch (error) {
      toast.add({
        type: "error",
        title: "Remove failed",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setMirrorRemoving(false);
    }
  }

  async function submit(confirm: boolean) {
    if (!definition) return;
    if (!definition.label.trim() || !definition.name.trim()) {
      setTableNameError("Table Name is required.");
      return;
    }
    setTableNameError(null);
    setSaving(true);
    try {
      const response = isNew
        ? await api.create(definition, confirm)
        : await api.update(definition, confirm);
      if (response.requiresConfirm) {
        setPendingConfirm(response.destructiveSummary ?? []);
        return;
      }
      setPendingConfirm(null);
      toast.add({ type: "success", title: `Saved "${definition.label}".` });
      route(`${path}/content-types?selectedKind=${definition.kind}`);
    } catch (error) {
      toast.add({
        type: "error",
        title: "Save failed",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    if (isNew) {
      submit(false);
    } else {
      setShowApplyConfirm(true);
    }
  }

  async function handleDelete() {
    if (!definition) return;
    setDeleting(true);
    try {
      await api.remove(definition.id);
      setShowDeleteConfirm(false);
      toast.add({
        type: "success",
        title: `Deleted "${definition.label || definition.name}".`,
      });
      route(`${path}/content-types?selectedKind=${definition.kind}`);
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

  return (
    <>
      <div class="page-header">
        <a
          role="button"
          href={backTo}
          class="icon ghost"
          onClick={(event) => {
            event.preventDefault();
            requestLeave(backTo);
          }}
        >
          <ArrowLeftIcon />
        </a>
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
        <div class="row">
          <button
            type="button"
            class="outline"
            onClick={() => requestLeave(backTo)}
          >
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={handleSaveClick}>
            Save & apply schema
          </button>
        </div>
      </div>

      <div class="content-type-editor-grid">
        <legend class="stack">
          <FieldsList
            systemEntries={systemFieldsForUi(definition, allTypes)}
            fields={definition.fields}
            features={definition.features}
            fieldOrder={definition.fieldOrder}
            type={KIND_LABELS[definition.kind]}
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
            features={definition.features}
            onChange={(key, value) =>
              setDefinition((d) =>
                d ? { ...d, features: { ...d.features, [key]: value } } : d,
              )
            }
          />

          {!isNew && (
            <div class="content-type-editor-danger">
              <div>
                <h2>Danger zone</h2>
                <p>
                  Delete this {definition.kind} and all of its data. This cannot
                  be undone.
                </p>
              </div>
              <button
                type="button"
                class="destructive"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <TrashIcon /> Delete {definition.kind}
              </button>
            </div>
          )}
        </div>
      </div>

      <FieldDialog
        open={fieldDialogOpen}
        editingField={editingField}
        dynamicOptions={dynamicOptions}
        fieldSides={definition.fieldSides}
        showSideToggle={definition.kind !== "component"}
        onCancel={() => setFieldDialogOpen(false)}
        onSave={handleFieldSave}
      />

      <ConfirmDialog
        open={pendingMirrorRemove !== null}
        title={`Remove "${pendingMirrorRemove?.mirror?.sourceFieldLabel ?? ""}"?`}
        message={
          <p>
            This deletes "{pendingMirrorRemove?.mirror?.sourceFieldLabel}" from
            "{pendingMirrorRemove?.mirror?.sourceTypeLabel}" - saving that
            content type will drop its column/table, and any data in it.
          </p>
        }
        confirmLabel="Remove"
        destructive
        busy={mirrorRemoving}
        onConfirm={() => {
          if (pendingMirrorRemove) deleteMirrorSource(pendingMirrorRemove, false);
        }}
        onCancel={() => setPendingMirrorRemove(null)}
      />

      <ConfirmDialog
        open={mirrorDestructiveSummary !== null}
        title="This will lose data"
        message={
          <ul>
            {(mirrorDestructiveSummary ?? []).map((change, index) => (
              <li key={index}>{describeDestructiveChange(change)}</li>
            ))}
          </ul>
        }
        confirmLabel="Remove anyway"
        destructive
        busy={mirrorRemoving}
        onConfirm={() => {
          if (pendingMirrorRemove) deleteMirrorSource(pendingMirrorRemove, true);
        }}
        onCancel={() => setMirrorDestructiveSummary(null)}
      />

      <ConfirmDialog
        open={showApplyConfirm}
        title="Apply schema changes?"
        message={
          <p>Saving will apply these schema changes to the live table.</p>
        }
        confirmLabel="Save & apply"
        busy={saving}
        onConfirm={() => {
          setShowApplyConfirm(false);
          submit(false);
        }}
        onCancel={() => setShowApplyConfirm(false)}
      />

      <ConfirmDialog
        open={pendingConfirm !== null}
        title="This save will lose data"
        message={
          <ul>
            {(pendingConfirm ?? []).map((change, index) => (
              <li key={index}>{describeDestructiveChange(change)}</li>
            ))}
          </ul>
        }
        confirmLabel="Save anyway"
        destructive
        busy={saving}
        onConfirm={() => submit(true)}
        onCancel={() => setPendingConfirm(null)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete "${definition.label || definition.name}"?`}
        message={
          <p>
            This permanently deletes the {definition.kind} and all of its data.
            This cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
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
          route(to);
        }}
        onCancel={() => setLeaveTo(null)}
      />
    </>
  );
}

function describeDestructiveChange(change: DestructiveChange): string {
  switch (change.kind) {
    case "drop-column":
      return `Column "${change.columnName}" on "${change.tableName}" will be dropped - its data will be lost.`;
    case "drop-table":
      return `Table "${change.tableName}" will be dropped - every row in it will be lost.`;
    case "shape-changed":
      return `"${change.columnOrField}" on "${change.tableName}" changes from ${change.from} to ${change.to} - its existing data will be lost.`;
    case "lossy-retype":
      return `Column "${change.columnName}" on "${change.tableName}" changes type from ${change.from} to ${change.to} - values that don't convert cleanly will become 0/empty.`;
    default:
      return "This field will change.";
  }
}
