import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import CheckField from "../components/CheckField.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { useDialogSync } from "../components/FileManager.js";
import NumberField from "../components/NumberField.js";
import Select from "../components/Select.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import {
  fieldTypes,
  type SettingDescriptor,
  type SettingOption,
} from "../content-types/field-registry.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { DestructiveChange } from "../content-types/migration.js";
import type {
  ContentTypeDefinition,
  ContentTypeFeatures,
  ContentTypeKind,
  FieldDefinition,
} from "../content-types/types.js";
import { ArrowLeftIcon } from "../components/icons.js";

interface Props {
  id?: string;
  kind?: string;
}

function slugifyPreview(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const FEATURES_BY_KIND: Record<
  ContentTypeKind,
  { key: keyof ContentTypeFeatures; label: string }[]
> = {
  collection: [
    { key: "slug", label: "Slug" },
    { key: "draft", label: "Draft" },
    { key: "schedule", label: "Schedule" },
    { key: "fullSearch", label: "Full-text search" },
  ],
  singleton: [{ key: "slug", label: "Slug" }],
  component: [],
};

function systemFieldLabels(definition: ContentTypeDefinition): string[] {
  if (definition.kind === "component") return [];
  const labels = ["Title"];
  if (definition.features?.slug) labels.push("Slug");
  if (definition.kind === "collection" && definition.features?.draft)
    labels.push("Draft");
  if (definition.kind === "collection" && definition.features?.schedule)
    labels.push("Schedule");
  return labels;
}

/** Renders a list of `SettingDescriptor`s against a plain values object - one
 * shared form for every field type's "Add Field" settings, instead of a
 * bespoke settings form per type. */
function SettingsForm({
  descriptors,
  values,
  onChange,
  dynamicOptions,
}: {
  descriptors: SettingDescriptor[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  dynamicOptions: { collections: SettingOption[]; components: SettingOption[] };
}) {
  if (descriptors.length === 0) return null;
  return (
    <>
      {descriptors.map((d) => {
        if (d.widget === "boolean") {
          return (
            <CheckField
              key={d.key}
              label={d.label}
              value={!!values[d.key]}
              onChange={(v) => onChange(d.key, v)}
            />
          );
        }
        if (d.widget === "text") {
          return (
            <TextField
              key={d.key}
              label={d.label}
              value={
                typeof values[d.key] === "string"
                  ? (values[d.key] as string)
                  : ""
              }
              onChange={(v) => onChange(d.key, v)}
            />
          );
        }
        if (d.widget === "number") {
          return (
            <NumberField
              key={d.key}
              label={d.label}
              value={
                typeof values[d.key] === "number"
                  ? (values[d.key] as number)
                  : 0
              }
              onChange={(v) => onChange(d.key, v)}
            />
          );
        }
        const options = d.optionsSource
          ? dynamicOptions[d.optionsSource]
          : (d.options ?? []);
        return (
          <div class="field" key={d.key}>
            <label>{d.label}</label>
            <Select
              options={options}
              value={values[d.key] as string | undefined}
              onChange={(v) => onChange(d.key, v)}
            />
          </div>
        );
      })}
    </>
  );
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
  const [nameTouched, setNameTouched] = useState(!isNew);

  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState("text");
  const [draftName, setDraftName] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({});
  const [draftValidation, setDraftValidation] = useState<
    Record<string, unknown>
  >({});

  const [pendingConfirm, setPendingConfirm] = useState<
    DestructiveChange[] | null
  >(null);

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
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load content type.",
        );
      }
    })();
  }, [id, kind]);

  useEffect(() => {
    document.title = isNew ? "New content type" : "Edit content type";
  }, [isNew]);

  useEffect(() => {
    if (!definition || nameTouched) return;
    const nextName = slugifyPreview(definition.label);
    if (nextName !== definition.name)
      setDefinition((d) => (d ? { ...d, name: nextName } : d));
  }, [definition?.label, nameTouched]);

  const fieldDialogRef = useDialogSync(fieldDialogOpen, () =>
    setFieldDialogOpen(false),
  );

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

  function openAddField() {
    setEditingFieldId(null);
    setDraftType("text");
    setDraftName("");
    setDraftLabel("");
    setDraftConfig({});
    setDraftValidation({});
    setFieldDialogOpen(true);
  }

  function openEditField(field: FieldDefinition) {
    setEditingFieldId(field.id);
    setDraftType(field.type);
    setDraftName(field.name);
    setDraftLabel(field.label);
    setDraftConfig((field.config as Record<string, unknown>) ?? {});
    setDraftValidation((field.validation as Record<string, unknown>) ?? {});
    setFieldDialogOpen(true);
  }

  function saveDraftField() {
    if (!draftName.trim()) {
      toast.add({ type: "error", title: "Field name is required." });
      return;
    }
    const nextField: FieldDefinition = {
      id: editingFieldId ?? crypto.randomUUID(),
      name: draftName.trim(),
      label: draftLabel.trim() || draftName.trim(),
      type: draftType,
      config: draftConfig,
      validation: draftValidation,
    };
    setDefinition((d) => {
      if (!d) return d;
      const fields = editingFieldId
        ? d.fields.map((f) => (f.id === editingFieldId ? nextField : f))
        : [...d.fields, nextField];
      return { ...d, fields };
    });
    setFieldDialogOpen(false);
  }

  function removeField(fieldId: string) {
    setDefinition((d) =>
      d ? { ...d, fields: d.fields.filter((f) => f.id !== fieldId) } : d,
    );
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    setDefinition((d) => {
      if (!d) return d;
      const index = d.fields.findIndex((f) => f.id === fieldId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= d.fields.length) return d;
      const fields = [...d.fields];
      const [moved] = fields.splice(index, 1);
      fields.splice(target, 0, moved!);
      return { ...d, fields };
    });
  }

  async function submit(confirm: boolean) {
    if (!definition) return;
    if (!definition.label.trim() || !definition.name.trim()) {
      toast.add({ type: "error", title: "Title is required." });
      return;
    }
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

  if (loadError) return <span class="error">{loadError}</span>;
  if (!definition) return <span class="hint">Loading…</span>;

  const activeFieldType = fieldTypes[draftType];
  const features = FEATURES_BY_KIND[definition.kind];

  return (
    <>
      <div class="page-header">
        <a role="button" href={`${path}/content-types/`} class="icon ghost">
          <ArrowLeftIcon />
        </a>
        <div style={{ flex: 1 }}>
          <h1>
            {isNew
              ? `New ${definition.kind}`
              : definition.label || definition.name}
          </h1>
          <p>
            {definition.kind === "component"
              ? "Reusable field group, embeddable in other content types."
              : "Content type schema."}
          </p>
        </div>
        <div class="row">
          <button
            type="button"
            class="outline"
            onClick={() => route(`${path}/content-types`)}
          >
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={() => submit(false)}>
            Save
          </button>
        </div>
      </div>

      <div class="content-type-editor-grid">
        <legend class="stack">
          {definition.kind !== "component" && (
            <>
              <div>
                <h3>System fields</h3>
                <ul class="content-type-list">
                  {systemFieldLabels(definition).map((label) => (
                    <li key={label} class="content-type-list-item row">
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <hr style={{width: 'calc(100% + 4rem)', marginInline: '-2rem'}} />
            </>
          )}

          <div>
            <div class="row justify-between">
              <h3>Fields</h3>
              <button type="button" class="outline sm" onClick={openAddField}>
                + Add Field
              </button>
            </div>
            <ul class="content-type-list">
              {definition.fields.length === 0 && (
                <li class="hint">No custom fields yet.</li>
              )}
              {definition.fields.map((field, index) => (
                <li
                  key={field.id}
                  class="content-type-list-item row justify-between"
                  onClick={() => openEditField(field)}
                >
                  <span>
                    {field.label}{" "}
                    <span class="hint">
                      ({fieldTypes[field.type]?.label ?? field.type})
                    </span>
                  </span>
                  <div class="row" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      class="ghost icon sm"
                      disabled={index === 0}
                      onClick={() => moveField(field.id, -1)}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="ghost icon sm"
                      disabled={index === definition.fields.length - 1}
                      onClick={() => moveField(field.id, 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="ghost sm"
                      onClick={() => removeField(field.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </legend>
        <div class="stack">
          <TextField
            label="Title"
            value={definition.label}
            onChange={(v) => setDefinition((d) => (d ? { ...d, label: v } : d))}
          />
          <TextField
            label="Description"
            multiline
            value={definition.description ?? ""}
            onChange={(v) =>
              setDefinition((d) => (d ? { ...d, description: v } : d))
            }
          />
          <TextField
            label="Technical name"
            helperText={`Table name: "${definition.name || "-"}"`}
            value={definition.name}
            onChange={(v) => {
              setNameTouched(true);
              setDefinition((d) => (d ? { ...d, name: v } : d));
            }}
          />

          {features.length > 0 && (
            <fieldset>
              <legend>Features</legend>
              {features.map(({ key, label }) => (
                <CheckField
                  key={key}
                  label={label}
                  value={!!definition.features?.[key]}
                  onChange={(v) =>
                    setDefinition((d) =>
                      d ? { ...d, features: { ...d.features, [key]: v } } : d,
                    )
                  }
                />
              ))}
            </fieldset>
          )}
        </div>
      </div>

      <dialog
        ref={fieldDialogRef}
        aria-label={editingFieldId ? "Edit field" : "Add field"}
        class="xl"
      >
        {fieldDialogOpen && (
          <>
            <header>
              <h3>{editingFieldId ? "Edit field" : "Add field"}</h3>
            </header>
            <div class="stack">
              <div class="field">
                <label>Type</label>
                <Select
                  options={Object.values(fieldTypes).map((t) => ({
                    value: t.key,
                    label: t.label,
                  }))}
                  value={draftType}
                  onChange={(value) => {
                    setDraftType(value);
                    setDraftConfig({});
                    setDraftValidation({});
                  }}
                  disabled={editingFieldId !== null}
                />
              </div>
              <TextField
                label="Name"
                value={draftName}
                onChange={setDraftName}
              />
              <TextField
                label="Label"
                value={draftLabel}
                onChange={setDraftLabel}
                placeholder={draftName}
              />

              {activeFieldType &&
                (activeFieldType.configFields?.length ?? 0) > 0 && (
                  <fieldset>
                    <legend>Display</legend>
                    <div>
                      <SettingsForm
                        descriptors={activeFieldType.configFields ?? []}
                        values={draftConfig}
                        onChange={(key, value) =>
                          setDraftConfig((c) => ({ ...c, [key]: value }))
                        }
                        dynamicOptions={dynamicOptions}
                      />
                    </div>
                  </fieldset>
                )}

              {activeFieldType &&
                (activeFieldType.validationFields?.length ?? 0) > 0 && (
                  <fieldset>
                    <legend>Validation</legend>
                    <SettingsForm
                      descriptors={activeFieldType.validationFields ?? []}
                      values={draftValidation}
                      onChange={(key, value) =>
                        setDraftValidation((c) => ({ ...c, [key]: value }))
                      }
                      dynamicOptions={dynamicOptions}
                    />
                  </fieldset>
                )}
            </div>
            <footer>
              <button
                type="button"
                class="outline"
                onClick={() => setFieldDialogOpen(false)}
              >
                Cancel
              </button>
              <button type="button" onClick={saveDraftField}>
                Save field
              </button>
            </footer>
          </>
        )}
      </dialog>

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
        busy={saving}
        onConfirm={() => submit(true)}
        onCancel={() => setPendingConfirm(null)}
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
