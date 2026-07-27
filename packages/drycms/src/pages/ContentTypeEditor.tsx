import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import ConfirmDialog from "../components/ConfirmDialog.js";
import SlugField from "../components/SlugField.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { randomUUID } from "../lib/uuid.js";
import type { DestructiveChange } from "../content-types/migration.js";
import { defaultContentTypeDefinitions } from "../content-types/seed.js";
import type {
  ContentTypeDefinition,
  ContentTypeFeatures,
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
 * - and can't be dragged/reordered/removed. It's hidden from the UI for
 * singletons (a single row's numeric id isn't meaningful to show) even
 * though the column itself still exists.
 * Title is bundled with Slug (turning `slug` on adds both, in that order);
 * Draft/Schedule/Timestamps are collection-only. */
function systemFieldsForUi(
  definition: ContentTypeDefinition,
): SystemFieldEntry[] {
  if (definition.kind === "component") return [];
  const items: SystemFieldEntry[] =
    definition.kind === "singleton"
      ? []
      : [{ id: "id", label: "ID", name: "id", typeLabel: "Number" }];
  if (definition.features?.slug) {
    items.push(
      { id: "title", label: "Title", name: "title", typeLabel: "Text" },
      { id: "slug", label: "Slug", name: "slug", typeLabel: "Text" },
    );
  }
  if (definition.features?.seo) {
    items.push({
      id: "seo",
      label: "SEO",
      name: "seo",
      typeLabel: "Component",
    });
  }
  if (definition.kind === "collection") {
    if (definition.features?.draft) {
      items.push({
        id: "draft",
        label: "Draft",
        name: "draft",
        typeLabel: "Boolean",
      });
    }
    if (definition.features?.schedule) {
      items.push({
        id: "schedule",
        label: "Schedule",
        name: "schedule",
        typeLabel: "Date",
      });
    }
    if (definition.features?.timestamps) {
      items.push(
        {
          id: "createdAt",
          label: "Created at",
          name: "createdAt",
          typeLabel: "Date",
        },
        {
          id: "updatedAt",
          label: "Updated at",
          name: "updatedAt",
          typeLabel: "Date",
        },
      );
    }
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
  const dynamicOptions = useMemo(
    () => ({
      collections: allTypes
        .filter((t) => t.kind === "collection" && t.id !== definition?.id)
        .map((t) => ({ value: t.id, label: t.label })),
      components: allTypes
        .filter(
          (t) =>
            t.kind === "component" && t.id !== definition?.id && !t.system,
        )
        .map((t) => ({ value: t.id, label: t.label })),
    }),
    [allTypes, definition?.id],
  );

  // Sourced from the CURRENTLY installed defaults (never from the loaded
  // `definition` itself) - a drycms upgrade that newly requires a feature on
  // an already-seeded built-in must reflect here immediately, not only after
  // that row is next resaved. Mirrors `routes/content-types.ts`'s
  // `validateSystemProtections` call, which is the actual authority.
  const matchingDefault = useMemo(
    () =>
      definition
        ? defaultContentTypeDefinitions().find((t) => t.id === definition.id)
        : undefined,
    [definition?.id],
  );
  const requiredFeatureKeys = useMemo(() => {
    const required = matchingDefault?.features;
    if (!required) return undefined;
    return new Set(
      (Object.keys(required) as (keyof ContentTypeFeatures)[]).filter(
        (key) => required[key],
      ),
    );
  }, [matchingDefault]);

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
      // Belt-and-suspenders: `FieldsList` already hides the Remove action for
      // `locked` fields, but a locked field's removal is refused here too
      // rather than trusting the UI alone - the server re-checks against the
      // stored definition regardless either way (see `validateSystemProtections`).
      if (d.fields.find((f) => f.id === fieldId)?.locked) return d;
      return {
        ...d,
        fields: withNormalizedOrder(d.fields.filter((f) => f.id !== fieldId)),
      };
    });
  }

  function handleFieldSave(field: FieldDefinition) {
    setDefinition((d) => {
      if (!d) return d;
      const fields = editingField
        ? d.fields.map((f) => (f.id === editingField.id ? field : f))
        : [...d.fields, field];
      return { ...d, fields: withNormalizedOrder(fields) };
    });
    setFieldDialogOpen(false);
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
  if (!definition) return <span class="hint">Loading…</span>;

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
            <span class="badge sm outline" style={{ marginRight: "0.5rem" }}>
              {KIND_LABELS[definition.kind]}
            </span>
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
            systemEntries={systemFieldsForUi(definition)}
            fields={definition.fields}
            features={definition.features}
            onEdit={(field) => {
              setEditingField(field);
              setFieldDialogOpen(true);
            }}
            onRemove={removeField}
            onReorderFields={updateFields}
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
            disabled={definition.system}
            error={!!tableNameError}
            helperText={
              definition.system
                ? "Set by the system and can't be changed."
                : (tableNameError ?? undefined)
            }
          />
          <TextField
            label="Description"
            multiline
            placeholder="e.g. Articles published on the company blog"
            value={definition.description ?? ""}
            onChange={(v) =>
              setDefinition((d) => (d ? { ...d, description: v } : d))
            }
            disabled={definition.system}
            helperText={
              definition.system
                ? "Set by the system and can't be changed."
                : "Optional description for this content type, shown in the admin UI."
            }
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
            disabled={definition.system}
            requiredKeys={requiredFeatureKeys}
          />

          {!isNew && definition.system && (
            <div class="content-type-editor-danger">
              <div>
                <h2>Built-in content type</h2>
                <p>
                  {`"${definition.label}" is one of the app's defaults and can't be deleted. New fields can still be added and reordered, but its locked fields are view-only and no feature can be toggled.`}
                </p>
              </div>
            </div>
          )}

          {!isNew && !definition.system && (
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
        onCancel={() => setFieldDialogOpen(false)}
        onSave={handleFieldSave}
        readOnly={definition.system && !!editingField?.locked}
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
