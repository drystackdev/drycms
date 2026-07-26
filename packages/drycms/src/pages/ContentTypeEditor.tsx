import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import ConfirmDialog from "../components/ConfirmDialog.js";
import SlugField from "../components/SlugField.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { DestructiveChange } from "../content-types/migration.js";
import type { ContentTypeDefinition, ContentTypeKind, FieldDefinition } from "../content-types/types.js";
import { ArrowLeftIcon } from "../components/icons.js";
import FeaturesFieldset from "./content-type-editor/FeaturesFieldset.js";
import FieldDialog from "./content-type-editor/FieldDialog.js";
import FieldsList, { type SystemFieldEntry } from "./content-type-editor/FieldsList.js";

interface Props {
  id?: string;
  kind?: string;
}

/** ID always shows (it's a real column, just baked directly into every
 * generated `CREATE TABLE` rather than going through `systemFieldsFor` -
 * see that file's doc comment - and can't be dragged/reordered/removed).
 * Title is bundled with Slug (turning `slug` on adds both, in that order);
 * Draft/Schedule/Timestamps are collection-only. */
function systemFieldsForUi(definition: ContentTypeDefinition): SystemFieldEntry[] {
  if (definition.kind === "component") return [];
  const items: SystemFieldEntry[] = [{ id: "id", label: "ID", name: "id", typeLabel: "Number" }];
  if (definition.features?.slug) {
    items.push(
      { id: "title", label: "Title", name: "title", typeLabel: "Text" },
      { id: "slug", label: "Slug", name: "slug", typeLabel: "Text" },
    );
  }
  if (definition.kind === "collection") {
    if (definition.features?.draft) {
      items.push({ id: "draft", label: "Draft", name: "draft", typeLabel: "Boolean" });
    }
    if (definition.features?.schedule) {
      items.push({ id: "schedule", label: "Schedule", name: "schedule", typeLabel: "Date" });
    }
    if (definition.features?.timestamps) {
      items.push(
        { id: "createdAt", label: "Created at", name: "created_at", typeLabel: "Date" },
        { id: "updatedAt", label: "Updated at", name: "updated_at", typeLabel: "Date" },
      );
    }
  }
  return items;
}

export default function ContentTypeEditor({ id, kind }: Props) {
  const { route } = useLocation();
  const api = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const isNew = !id;

  const [definition, setDefinition] = useState<ContentTypeDefinition | null>(null);
  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDefinition | null>(null);

  const [pendingConfirm, setPendingConfirm] = useState<DestructiveChange[] | null>(null);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const types = await api.list();
        setAllTypes(types);
        if (id) {
          setDefinition(types.find((t) => t.id === id) ?? (await api.get(id)));
        } else {
          const initialKind: ContentTypeKind =
            kind === "singleton" || kind === "component" ? kind : "collection";
          setDefinition({
            id: crypto.randomUUID(),
            kind: initialKind,
            name: "",
            label: "",
            description: "",
            features: {},
            fields: [],
            version: 0,
          });
        }
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load content type.");
      }
    })();
  }, [id, kind]);

  useEffect(() => {
    document.title = isNew ? "New content type" : "Edit content type";
  }, [isNew]);

  const dynamicOptions = useMemo(
    () => ({
      collections: allTypes
        .filter((t) => t.kind === "collection" && t.id !== definition?.id)
        .map((t) => ({ value: t.id, label: t.label })),
      components: allTypes
        .filter((t) => t.kind === "component" && t.id !== definition?.id)
        .map((t) => ({ value: t.id, label: t.label })),
    }),
    [allTypes, definition?.id],
  );

  function updateFields(fields: FieldDefinition[]) {
    setDefinition((d) => (d ? { ...d, fields } : d));
  }

  function removeField(fieldId: string) {
    setDefinition((d) => (d ? { ...d, fields: d.fields.filter((f) => f.id !== fieldId) } : d));
  }

  function handleFieldSave(field: FieldDefinition) {
    setDefinition((d) => {
      if (!d) return d;
      const fields = editingField ? d.fields.map((f) => (f.id === editingField.id ? field : f)) : [...d.fields, field];
      return { ...d, fields };
    });
    setFieldDialogOpen(false);
  }

  async function submit(confirm: boolean) {
    if (!definition) return;
    if (!definition.label.trim() || !definition.name.trim()) {
      toast.add({ type: "error", title: "Title is required." });
      return;
    }
    setSaving(true);
    try {
      const response = isNew ? await api.create(definition, confirm) : await api.update(definition, confirm);
      if (response.requiresConfirm) {
        setPendingConfirm(response.destructiveSummary ?? []);
        return;
      }
      setPendingConfirm(null);
      toast.add({ type: "success", title: `Saved "${definition.label}".` });
      route(`${path}/content-types`);
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
      toast.add({ type: "success", title: `Deleted "${definition.label || definition.name}".` });
      route(`${path}/content-types`);
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

  return (
    <>
      <div class="page-header">
        <a role="button" href={`${path}/content-types/`} class="icon ghost">
          <ArrowLeftIcon />
        </a>
        <div style={{ flex: 1 }}>
          <h1>{isNew ? `New ${definition.kind}` : definition.label || definition.name}</h1>
          <p>
            {definition.kind === "component"
              ? "Reusable field group, embeddable in other content types."
              : "Content type schema."}
          </p>
        </div>
        <div class="row">
          <button type="button" class="outline" onClick={() => route(`${path}/content-types`)}>
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
            label="Title"
            slugLabel="Table Name"
            value={definition.label}
            slug={definition.name}
            onChange={(label, name) => setDefinition((d) => (d ? { ...d, label, name } : d))}
          />
          <TextField
            label="Description"
            multiline
            value={definition.description ?? ""}
            onChange={(v) => setDefinition((d) => (d ? { ...d, description: v } : d))}
          />

          <FeaturesFieldset
            kind={definition.kind}
            features={definition.features}
            onChange={(key, value) =>
              setDefinition((d) => (d ? { ...d, features: { ...d.features, [key]: value } } : d))
            }
          />
        </div>
      </div>

      {!isNew && (
        <div class="content-type-editor-danger">
          <div>
            <h2>Danger zone</h2>
            <p>
              Delete this {definition.kind} and all of its data. This cannot be undone.
            </p>
          </div>
          <button type="button" class="destructive" onClick={() => setShowDeleteConfirm(true)}>
            Delete {definition.kind}
          </button>
        </div>
      )}

      <FieldDialog
        open={fieldDialogOpen}
        editingField={editingField}
        dynamicOptions={dynamicOptions}
        onCancel={() => setFieldDialogOpen(false)}
        onSave={handleFieldSave}
      />

      <ConfirmDialog
        open={showApplyConfirm}
        title="Apply schema changes?"
        message={<p>Saving will apply these schema changes to the live table.</p>}
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
            This permanently deletes the {definition.kind} and all of its data. This cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
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
