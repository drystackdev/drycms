import { useEffect, useState } from "preact/hooks";
import CheckField from "../../components/CheckField.js";
import DatePickerField from "../../components/DatePickerField.js";
import { useDialogSync } from "../../components/FileManager.js";
import NumberField from "../../components/NumberField.js";
import Select from "../../components/Select.js";
import SlugField from "../../components/SlugField.js";
import TextField from "../../components/TextField.js";
import { toast } from "../../components/Toast.js";
import {
  fieldTypes,
  resolveFieldShape,
  type FieldTypeDefinition,
  type SettingDescriptor,
  type SettingOption,
} from "../../content-types/field-registry.js";
import type { FieldDefinition, FieldValidation } from "../../content-types/types.js";

export interface FieldDialogProps {
  open: boolean;
  /** `null` means "Add field"; otherwise the field being edited. */
  editingField: FieldDefinition | null;
  dynamicOptions: { collections: SettingOption[]; components: SettingOption[] };
  onCancel: () => void;
  onSave: (field: FieldDefinition) => void;
}

/** Renders a list of `SettingDescriptor`s against a plain values object - one
 * shared form for every field type's "Add Field" settings, instead of a
 * bespoke settings form per type. `disabledKeys` lets a caller grey out
 * individual controls (e.g. text's `required` while `regex`/`minLength`
 * force it on) without forking the render per descriptor. */
function SettingsForm({
  descriptors,
  values,
  onChange,
  dynamicOptions,
  disabledKeys = [],
}: {
  descriptors: SettingDescriptor[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  dynamicOptions: { collections: SettingOption[]; components: SettingOption[] };
  disabledKeys?: string[];
}) {
  if (descriptors.length === 0) return null;
  return (
    <>
      {descriptors.map((d) => {
        const disabled = disabledKeys.includes(d.key);
        if (d.widget === "boolean") {
          return (
            <CheckField
              key={d.key}
              label={d.label}
              value={!!values[d.key]}
              disabled={disabled}
              onChange={(v) => onChange(d.key, v)}
            />
          );
        }
        if (d.widget === "text") {
          return (
            <TextField
              key={d.key}
              label={d.label}
              value={typeof values[d.key] === "string" ? (values[d.key] as string) : ""}
              disabled={disabled}
              onChange={(v) => onChange(d.key, v)}
            />
          );
        }
        if (d.widget === "number") {
          return (
            <NumberField
              key={d.key}
              label={d.label}
              value={typeof values[d.key] === "number" ? (values[d.key] as number) : 0}
              disabled={disabled}
              onChange={(v) => onChange(d.key, v)}
            />
          );
        }
        const options = d.optionsSource ? dynamicOptions[d.optionsSource] : (d.options ?? []);
        return (
          <div class="field" key={d.key}>
            <label>{d.label}</label>
            <Select
              options={options}
              value={values[d.key] as string | undefined}
              disabled={disabled}
              onChange={(v) => onChange(d.key, v)}
            />
          </div>
        );
      })}
    </>
  );
}

/** Type-appropriate "Default value" input - not routed through
 * `SettingsForm` since its value type must match the field's own value type,
 * not a generic widget. No default for image/relation/component: a static
 * default doesn't make sense for an uploaded asset or a relation. */
function DefaultValueInput({
  activeType,
  config,
  value,
  onChange,
}: {
  activeType: FieldTypeDefinition | undefined;
  config: unknown;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (!activeType || resolveFieldShape(activeType, config) !== "column") return null;
  switch (activeType.key) {
    case "text":
      return (
        <TextField label="Default value" value={typeof value === "string" ? value : ""} onChange={onChange} />
      );
    case "number":
      return (
        <NumberField label="Default value" value={typeof value === "number" ? value : 0} onChange={onChange} />
      );
    case "boolean":
      return <CheckField label="Default value" value={!!value} onChange={onChange} />;
    case "date":
      return (
        <DatePickerField
          label="Default value"
          value={value instanceof Date ? value : new Date()}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

/** Mutual-exclusivity + forced-required rules for `text` validation: picking
 * a `format` clears+disables `regex` and vice versa (a format implies a
 * canonical regex server-side - using both would conflict), and either
 * `regex` or `minLength` being set forces `required` on. */
function textValidationDisabledKeys(validation: Record<string, unknown>): string[] {
  const disabled: string[] = [];
  const hasRegex = typeof validation.regex === "string" && validation.regex.length > 0;
  const hasFormat = typeof validation.format === "string" && validation.format !== "none";
  if (hasFormat) disabled.push("regex");
  if (hasRegex) disabled.push("format");
  if (hasRegex || validation.minLength != null) disabled.push("required");
  return disabled;
}

export default function FieldDialog({ open, editingField, dynamicOptions, onCancel, onSave }: FieldDialogProps) {
  const dialogRef = useDialogSync(open, onCancel);

  const [draftType, setDraftType] = useState("text");
  const [draftName, setDraftName] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({});
  const [draftValidation, setDraftValidation] = useState<Record<string, unknown>>({});
  const [draftDefault, setDraftDefault] = useState<unknown>(undefined);

  useEffect(() => {
    if (!open) return;
    if (editingField) {
      setDraftType(editingField.type);
      setDraftName(editingField.name);
      setDraftLabel(editingField.label);
      setDraftDescription(editingField.description ?? "");
      setDraftConfig((editingField.config as Record<string, unknown>) ?? {});
      setDraftValidation((editingField.validation as Record<string, unknown>) ?? {});
      setDraftDefault(editingField.default);
    } else {
      // No type pre-selected - the right column stays an empty frame until
      // the user picks one (see the Type <Select>'s onChange below).
      setDraftType("");
      setDraftName("");
      setDraftLabel("");
      setDraftDescription("");
      setDraftConfig({});
      setDraftValidation({});
      setDraftDefault(undefined);
    }
  }, [open, editingField]);

  function handleValidationChange(key: string, value: unknown) {
    setDraftValidation((prev) => {
      const next: Record<string, unknown> = { ...prev, [key]: value };
      if (draftType === "text") {
        if (key === "regex" && typeof value === "string" && value.length > 0) {
          next.format = "none";
        } else if (key === "format" && value !== "none") {
          next.regex = "";
        }
        if ((typeof next.regex === "string" && next.regex.length > 0) || next.minLength != null) {
          next.required = true;
        }
      }
      return next;
    });
  }

  function handleSave() {
    if (!draftType) {
      toast.add({ type: "error", title: "Pick a field type first." });
      return;
    }
    if (!draftName.trim()) {
      toast.add({ type: "error", title: "Field name is required." });
      return;
    }
    onSave({
      id: editingField?.id ?? crypto.randomUUID(),
      name: draftName.trim(),
      label: draftLabel.trim() || draftName.trim(),
      description: draftDescription.trim() || undefined,
      type: draftType,
      config: draftConfig,
      validation: draftValidation as FieldValidation,
      default: draftDefault,
    });
  }

  const activeFieldType = fieldTypes[draftType];
  const textDisabledKeys = draftType === "text" ? textValidationDisabledKeys(draftValidation) : [];

  return (
    <dialog ref={dialogRef} aria-label={editingField ? "Edit field" : "Add field"} class="xl field-dialog">
      {open && (
        <>
          <header>
            <h3>{editingField ? "Edit field" : "Add field"}</h3>
          </header>
          <div class="field-dialog-grid">
            <div class="stack">
              <SlugField
                label="Label"
                slugLabel="Name"
                value={draftLabel}
                slug={draftName}
                onChange={(label, name) => {
                  setDraftLabel(label);
                  setDraftName(name);
                }}
              />
              <TextField label="Description" multiline value={draftDescription} onChange={setDraftDescription} />
              <div class="field">
                <label>Type</label>
                <Select
                  options={Object.values(fieldTypes).map((t) => ({ value: t.key, label: t.label }))}
                  value={draftType}
                  onChange={(value) => {
                    setDraftType(value);
                    const type = fieldTypes[value];
                    setDraftConfig(type?.defaultConfig ?? {});
                    setDraftValidation(type?.defaultValidation ?? {});
                    setDraftDefault(undefined);
                  }}
                  disabled={editingField !== null}
                />
              </div>
              <DefaultValueInput
                activeType={activeFieldType}
                config={draftConfig}
                value={draftDefault}
                onChange={setDraftDefault}
              />
            </div>

            <div class="stack">
              {activeFieldType && (activeFieldType.configFields?.length ?? 0) > 0 && (
                <fieldset>
                  <legend>Display</legend>
                  <div class="stack">
                    <SettingsForm
                      descriptors={activeFieldType.configFields ?? []}
                      values={draftConfig}
                      onChange={(key, value) => setDraftConfig((c) => ({ ...c, [key]: value }))}
                      dynamicOptions={dynamicOptions}
                    />
                  </div>
                </fieldset>
              )}

              {activeFieldType && (activeFieldType.validationFields?.length ?? 0) > 0 && (
                <fieldset>
                  <legend>Validation</legend>
                  <div class="stack">
                    <SettingsForm
                      descriptors={activeFieldType.validationFields ?? []}
                      values={draftValidation}
                      onChange={handleValidationChange}
                      dynamicOptions={dynamicOptions}
                      disabledKeys={textDisabledKeys}
                    />
                  </div>
                </fieldset>
              )}
            </div>
          </div>
          <footer>
            <button type="button" class="outline" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" onClick={handleSave}>
              Save field
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
