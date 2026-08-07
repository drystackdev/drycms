import { useEffect, useState } from "preact/hooks";
import CheckField from "../../components/fields/CheckField.js";
import DatePickerField from "../../components/fields/DatePickerField.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import MultiSelect from "../../components/MultiSelect.js";
import NumberField from "../../components/fields/NumberField.js";
import OptionListEditor from "../../components/OptionListEditor.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import RichTextField from "../../components/RichTextField.js";
import Select from "../../components/Select.js";
import SlugField from "../../components/fields/SlugField.js";
import TextField from "../../components/fields/TextField.js";
import { slugifyIdentifier } from "../../lib/slugify.js";
import { randomUUID } from "../../lib/uuid.js";
import {
  fieldTypes,
  resolveFieldShape,
  resolveValidationFields,
  type ComponentFieldConfig,
  type FieldTypeDefinition,
  type RelationFieldConfig,
  type RichTextFieldConfig,
  type SelectFieldConfig,
  type SettingDescriptor,
  type SettingOption,
} from "../../content-types/field-registry.js";
import { buildEntryFieldTree, flattenSummaryCandidates } from "../../content-types/engine/entry-tree.js";
import {
  defaultFieldSide,
  resolveFieldSide,
  type FieldSide,
} from "../../content-types/system-fields.js";
import type {
  ContentTypeDefinition,
  FieldDefinition,
  FieldValidation,
} from "../../content-types/types.js";

/** Right-side-emphasized two-panel icon for the Display-side toggle below -
 * exported for `MirrorFieldDialog.tsx`'s identical toggle. */
export function SideRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M22 11v2c0 3.771 0 5.657-1.172 6.828c-.974.975-2.442 1.139-5.078 1.166V3.006c2.636.027 4.104.191 5.078 1.166C22 5.343 22 7.229 22 11"
      />
      <path
        fill="currentColor"
        opacity="0.1"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 3h4.25v18H10c-3.771 0-5.657 0-6.828-1.172S2 16.771 2 13v-2c0-3.771 0-5.657 1.172-6.828S6.229 3 10 3m-5.25 7a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75m1 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75"
      />
    </svg>
  );
}

/** Left-side-emphasized two-panel icon for the Display-side toggle below -
 * exported for `MirrorFieldDialog.tsx`'s identical toggle. */
export function SideLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        opacity="0.1"
        d="M22 11v2c0 3.771 0 5.657-1.172 6.828c-.974.975-2.442 1.139-5.078 1.166V3.006c2.636.027 4.104.191 5.078 1.166C22 5.343 22 7.229 22 11"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 3h4.25v18H10c-3.771 0-5.657 0-6.828-1.172S2 16.771 2 13v-2c0-3.771 0-5.657 1.172-6.828S6.229 3 10 3m-5.25 7a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75m1 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75"
      />
    </svg>
  );
}

export interface FieldDialogProps {
  open: boolean;
  /** `null` means "Add field"; otherwise the field being edited. */
  editingField: FieldDefinition | null;
  /** True when `editingField`'s id is in `ContentTypeDefinition.
   * protectedFieldIds` (see `types.ts`) - every control renders read-only
   * (so an admin can still SEE the field's configuration) and the footer
   * drops Save down to a plain "Close", since there's nothing this dialog
   * could actually persist. */
  readOnly?: boolean;
  dynamicOptions: { collections: SettingOption[]; components: SettingOption[] };
  /** Every content type, `relation`'s target/`component`'s componentId
   * resolve against - needed to list the TARGET type's/component's own
   * fields for the "Display fields" picker (`DisplayFieldsInput` below),
   * which `dynamicOptions` (just id/label pairs) doesn't carry. */
  allTypes: ContentTypeDefinition[];
  /** Persisted per-field display side (see `types.ts`'s
   * `ContentTypeDefinition.fieldSides`) - seeds the Display side control
   * below when editing an existing field; ignored when adding one (no id
   * yet - the default is derived purely from the picked type instead). */
  fieldSides?: Record<string, FieldSide>;
  /** Currently-archived fields (see `types.ts`'s `deletedFieldIds`) - only
   * consulted while ADDING a field (`editingField === null`): naming a new
   * one after an archived field is never a genuine new column, so `handleSave`
   * reuses that archived field's `id` instead of minting a fresh one when the
   * type also matches (`ContentTypeEditor.tsx`'s `handleFieldSave` then
   * restores it in place rather than appending a real duplicate), or blocks
   * the save entirely when the type differs (a name can't mean two different
   * shapes at once). */
  archivedFields?: FieldDefinition[];
  /** `false` for `component`-kind types - see `FieldsList.tsx`'s identical
   * prop for why (their fields never render in a split left/right form). */
  showSideToggle: boolean;
  onCancel: () => void;
  onSave: (field: FieldDefinition, side: FieldSide) => void;
}

/** Descriptor keys that share a row instead of each getting their own full
 * width - `key` immediately followed by its pair in the descriptor array
 * (true for every field type's `validationFields` today). */
const PAIRED_ROWS: [string, string][] = [
  ["required", "unique"],
  ["inline", "layoutContent"],
  ["min", "max"],
  ["minLength", "maxLength"],
];

/** Demo placeholder text for the generic `"text"`-widget settings, keyed by
 * `SettingDescriptor.key` - covers keys shared across field types (only
 * `text`'s `placeholder`/`regex` today) without the registry itself needing
 * a placeholder field. */
const TEXT_WIDGET_PLACEHOLDERS: Record<string, string> = {
  placeholder: "e.g. Enter your name",
  regex: "e.g. ^[A-Za-z0-9_-]+$",
};

function groupIntoRows(
  descriptors: SettingDescriptor[],
): SettingDescriptor[][] {
  const rows: SettingDescriptor[][] = [];
  for (let i = 0; i < descriptors.length; i++) {
    const current = descriptors[i]!;
    const next = descriptors[i + 1];
    const isPair =
      next && PAIRED_ROWS.some(([a, b]) => current.key === a && next.key === b);
    if (isPair) {
      rows.push([current, next!]);
      i++;
    } else {
      rows.push([current]);
    }
  }
  return rows;
}

function renderControl({
  d,
  values,
  onChange,
  dynamicOptions,
  disabled,
  showErrors,
  outline = true,
}: {
  d: SettingDescriptor;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  dynamicOptions: { collections: SettingOption[]; components: SettingOption[] };
  disabled: boolean;
  showErrors: boolean;
  outline?: boolean;
}) {
  if (d.widget === "boolean") {
    return (
      <CheckField
        key={d.key}
        label={d.label}
        value={!!values[d.key]}
        disabled={disabled}
        onChange={(v) => onChange(d.key, v)}
        outline={outline}
      />
    );
  }
  if (d.widget === "text") {
    return (
      <TextField
        key={d.key}
        label={d.label}
        value={
          typeof values[d.key] === "string" ? (values[d.key] as string) : ""
        }
        placeholder={TEXT_WIDGET_PLACEHOLDERS[d.key]}
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
        value={
          typeof values[d.key] === "number" ? (values[d.key] as number) : 0
        }
        disabled={disabled}
        onChange={(v) => onChange(d.key, v)}
      />
    );
  }
  if (d.widget === "option-list") {
    return (
      <OptionListEditor
        key={d.key}
        label={d.label}
        value={Array.isArray(values[d.key]) ? (values[d.key] as string[]) : []}
        disabled={disabled}
        showErrors={showErrors}
        // The only `option-list` widget today is `select`'s own Options -
        // always mandatory (see `OptionListEditorProps.required`'s doc).
        required
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
        disabled={disabled}
        onChange={(v) => onChange(d.key, v)}
      />
    </div>
  );
}

/** Renders a list of `SettingDescriptor`s against a plain values object - one
 * shared form for every field type's "Add Field" settings, instead of a
 * bespoke settings form per type. Adjacent descriptors named in
 * `PAIRED_ROWS` (required+unique, min+max, minLength+maxLength) share a row
 * instead of each taking the full width. `disabledKeys` lets a caller grey
 * out individual controls (e.g. text's `required` while `regex`/`minLength`
 * force it on) without forking the render per descriptor. */
function SettingsForm({
  descriptors,
  values,
  onChange,
  dynamicOptions,
  disabledKeys = [],
  showErrors = false,
  outline = true,
  compactGroups = false,
}: {
  descriptors: SettingDescriptor[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  dynamicOptions: { collections: SettingOption[]; components: SettingOption[] };
  disabledKeys?: string[];
  showErrors?: boolean;
  outline?: boolean;
  compactGroups?: boolean;
}) {
  if (descriptors.length === 0) return null;
  const grouped = descriptors.some((descriptor) => descriptor.group);
  const groups = grouped
    ? [...new Set(descriptors.map((descriptor) => descriptor.group ?? ""))].map(
        (group) => ({
          group,
          descriptors: descriptors.filter(
            (descriptor) => (descriptor.group ?? "") === group,
          ),
        }),
      )
    : [{ group: "", descriptors }];

  const renderRows = (items: SettingDescriptor[]) =>
    groupIntoRows(items).map((row) =>
      row.length === 2 ? (
        <div
          class="row"
          style={{ alignItems: "flex-start" }}
          key={row.map((d) => d.key).join("-")}
        >
          {row.map((d) => (
            <div style={{ flex: 1, minWidth: 0 }} key={d.key}>
              {renderControl({
                d,
                values,
                onChange,
                dynamicOptions,
                disabled: disabledKeys.includes(d.key),
                showErrors,
                outline,
              })}
            </div>
          ))}
        </div>
      ) : (
        renderControl({
          d: row[0]!,
          values,
          onChange,
          dynamicOptions,
          disabled: disabledKeys.includes(row[0]!.key),
          showErrors,
          outline,
        })
      ),
    );

  return (
    <>
      {groups.map(({ group, descriptors: groupDescriptors }) => (
        <div
          class="stack"
          style={compactGroups ? { gap: 0 } : undefined}
          key={group || "ungrouped"}
        >
          {group && <strong>{group}</strong>}
          {group ? (
            <div
              class="grid"
              style={{
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                ...(compactGroups ? { gap: 0 } : {}),
              }}
            >
              {groupDescriptors.map((descriptor) => (
                <div key={descriptor.key}>
                  {renderControl({
                    d: descriptor,
                    values,
                    onChange,
                    dynamicOptions,
                    disabled: disabledKeys.includes(descriptor.key),
                    showErrors,
                    outline,
                  })}
                </div>
              ))}
            </div>
          ) : (
            renderRows(groupDescriptors)
          )}
        </div>
      ))}
    </>
  );
}

/** Type-appropriate "Default value" input - not routed through
 * `SettingsForm` since its value type must match the field's own value type,
 * not a generic widget. No default for image/relation/component/
 * relationmirror: a static default doesn't make sense for an uploaded asset
 * or a relation (real or mirrored). */
function DefaultValueInput({
  activeType,
  config,
  value,
  onChange,
  disabled = false,
}: {
  activeType: FieldTypeDefinition | undefined;
  config: unknown;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  if (!activeType || resolveFieldShape(activeType, config) !== "column")
    return null;
  switch (activeType.key) {
    case "text":
      return (
        <TextField
          label="Default value"
          placeholder="e.g. Untitled"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "richtext":
      {
        const richTextConfig = config as RichTextFieldConfig;
        return (
          <RichTextField
            label="Default value"
            value={typeof value === "string" ? value : ""}
            onChange={onChange}
            inline={richTextConfig.inline === true}
            features={richTextConfig}
            disabled={disabled}
          />
        );
      }
    case "number":
      return (
        <NumberField
          label="Default value"
          value={typeof value === "number" ? value : 0}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "boolean":
      return (
        <CheckField
          label="Default value"
          value={!!value}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "date":
      return (
        <DatePickerField
          label="Default value"
          value={value instanceof Date ? value : new Date()}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case "select": {
      const selectConfig = config as SelectFieldConfig;
      const options = selectConfig.options.map((text) => ({
        value: text,
        label: text,
      }));
      return selectConfig.multiple ? (
        <div class="field">
          <label>Default value</label>
          <MultiSelect
            options={options}
            value={Array.isArray(value) ? (value as string[]) : []}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      ) : (
        <div class="field">
          <label>Default value</label>
          <Select
            options={options}
            value={typeof value === "string" ? value : undefined}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

/** Mutual-exclusivity + forced-required rules for `text` validation: picking
 * a `format` clears+disables `regex` and vice versa (a format implies a
 * canonical regex server-side - using both would conflict), and a
 * *meaningful* `regex` or `minLength` (i.e. actually constraining something)
 * forces `required` on - `minLength` sitting at its neutral `0` imposes no
 * real constraint, so it doesn't force anything. */
function textValidationDisabledKeys(
  validation: Record<string, unknown>,
): string[] {
  const disabled: string[] = [];
  const hasRegex =
    typeof validation.regex === "string" && validation.regex.length > 0;
  const hasFormat =
    typeof validation.format === "string" && validation.format !== "none";
  const hasMinLength =
    typeof validation.minLength === "number" && validation.minLength > 0;
  if (hasFormat) disabled.push("regex");
  if (hasRegex) disabled.push("format");
  if (hasRegex || hasMinLength) disabled.push("required");
  return disabled;
}

/** `component`'s `sortable` only means anything once `repeatable` is on (see
 * `field-registry.ts`'s `ComponentFieldConfig`) - a non-repeatable component
 * only ever has the one inline instance, nothing to reorder. */
function componentConfigDisabledKeys(
  config: Record<string, unknown>,
): string[] {
  return config.repeatable ? [] : ["sortable"];
}

/** `relation`'s `sortable` only means anything once `cardinality` is
 * `manyToMany` (see `field-registry.ts`'s `RelationFieldConfig`). */
function relationConfigDisabledKeys(config: Record<string, unknown>): string[] {
  return config.cardinality === "manyToMany" ? [] : ["sortable"];
}

/** A `select` field needs at least one non-blank, unique option - shared
 * between `handleSave`'s save-blocking check and the footer's "Fix the
 * highlighted fields." summary below, so both agree on the same condition
 * `OptionListEditor` itself already renders per-row/empty-list errors for
 * (via its own `showErrors` prop - see its doc comment). */
function selectOptionsInvalid(config: Record<string, unknown>): boolean {
  const trimmedOptions = (
    Array.isArray(config.options) ? (config.options as string[]) : []
  ).map((o) => o.trim());
  if (trimmedOptions.length === 0 || trimmedOptions.some((o) => o === ""))
    return true;
  return new Set(trimmedOptions).size !== trimmedOptions.length;
}

/** Lets the admin pick which of the TARGET type's (`relation`) or
 * component's OWN (`component`) fields a picked/added item's summary shows,
 * one per line, in schema order (`entry-tree.ts`'s
 * `flattenSummaryCandidates`, which - unlike `flattenDisplayColumns` -
 * offers `relation`/`component-repeat` fields too, each one an atomic
 * "nested list" pick rather than something to flatten further; see
 * `entry-summary.ts`'s `buildEntrySummary`, which resolves a nested pick
 * like that using THAT field's own `displayFields`, not anything configured
 * here). Not rendered before a target/component is actually chosen - there's
 * nothing to list yet - nor when that choice resolves to zero candidate
 * fields, nor for a non-repeatable `component` (dead control - see the
 * `repeatable` check below). Leaving the picker empty keeps the pre-existing
 * "first field" fallback (`RelationFieldConfig.displayFields`'s own doc
 * comment). */
function DisplayFieldsInput({
  draftType,
  config,
  allTypes,
  onChange,
  disabled = false,
}: {
  draftType: string;
  config: Record<string, unknown>;
  allTypes: ContentTypeDefinition[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  if (draftType !== "relation" && draftType !== "component" && draftType !== "relationmirror")
    return null;
  // A non-repeatable component renders as `flatten` - its fields inline
  // directly into the form, never through `ComponentField`/`renderSummary` -
  // so this control would be dead with nothing to affect. A `relation`
  // (any cardinality, including `manyToOne`) and a `relationmirror` always
  // render through `RelationField`, which shows a summary card even for a
  // single picked item - so those stay available regardless of cardinality.
  if (draftType === "component" && !(config.repeatable as ComponentFieldConfig["repeatable"] | undefined)) {
    return null;
  }
  const targetTypeId =
    draftType === "relation"
      ? (config.target as RelationFieldConfig["target"] | undefined)
      : draftType === "component"
        ? (config.componentId as ComponentFieldConfig["componentId"] | undefined)
        // A mirror has no `target` of its own - it picks FROM the source
        // relation's own type (`RelationMirrorFieldConfig.sourceTypeId`),
        // same "which type's fields are the candidates" question either way.
        : (config.sourceTypeId as string | undefined);
  const targetType = allTypes.find((t) => t.id === targetTypeId);
  if (!targetType) return null;

  const candidates = flattenSummaryCandidates(buildEntryFieldTree(targetType, allTypes));
  if (candidates.length === 0) return null;

  const value = Array.isArray(config.displayFields) ? (config.displayFields as string[]) : [];
  return (
    <div class="field">
      <label>Display fields</label>
      <small>
        Shown one per line wherever a picked/added item's summary appears
        (the entry editor's item list, the List page's column). Leaves just
        the first field when none are picked.
      </small>
      <MultiSelect
        options={candidates.map((c) => ({ value: c.fieldName, label: c.label }))}
        value={value}
        disabled={disabled}
        onChange={onChange}
        placeholder="e.g. Title, Image"
      />
    </div>
  );
}

export default function FieldDialog({
  open,
  editingField,
  readOnly = false,
  dynamicOptions,
  allTypes,
  fieldSides,
  archivedFields = [],
  showSideToggle,
  onCancel,
  onSave,
}: FieldDialogProps) {
  const dialogRef = useDialogSync(open, onCancel);
  // Deps include `open`: the grid only mounts once the dialog opens, so the
  // ref is still null on `FieldDialog`'s own first render.
  const { ref: gridScroll } = useOverlayScrollbars<HTMLDivElement>([open]);

  const [draftType, setDraftType] = useState("text");
  const [draftName, setDraftName] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({});
  const [draftValidation, setDraftValidation] = useState<
    Record<string, unknown>
  >({});
  const [draftDefault, setDraftDefault] = useState<unknown>(undefined);
  const [draftSide, setDraftSide] = useState<FieldSide>("left");
  // Gates OptionListEditor's per-row error highlighting - stays quiet while
  // the user is still filling the list in, same as `ComponentField`'s
  // `attempted` flag for its own item-list dialog.
  const [saveAttempted, setSaveAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSaveAttempted(false);
    if (editingField) {
      setDraftType(editingField.type);
      setDraftName(editingField.name);
      setDraftLabel(editingField.label);
      setDraftDescription(editingField.description ?? "");
      setDraftConfig((editingField.config as Record<string, unknown>) ?? {});
      setDraftValidation(
        (editingField.validation as Record<string, unknown>) ?? {},
      );
      setDraftDefault(editingField.default);
      setDraftSide(
        resolveFieldSide(
          editingField.id,
          editingField.type === "relation" ||
            editingField.type === "component" ||
            editingField.type === "relationmirror",
          fieldSides,
        ),
      );
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
      setDraftSide("left");
    }
    // `fieldSides` deliberately excluded - only meant to seed the draft once
    // per open/editingField change, not to keep re-syncing while the dialog
    // is open (the user's own toggle clicks would otherwise get clobbered).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingField]);

  function handleConfigChange(key: string, value: unknown) {
    const nextConfig: Record<string, unknown> = {
      ...draftConfig,
      [key]: value,
    };
    // Turning `repeatable` off makes `sortable` meaningless - clear it
    // rather than leaving a stale `true` sitting invisibly disabled.
    if (draftType === "component" && key === "repeatable" && !value) {
      nextConfig.sortable = false;
    }
    // Same for `relation`'s `sortable`, which only means anything at
    // `manyToMany` cardinality.
    if (
      draftType === "relation" &&
      key === "cardinality" &&
      value !== "manyToMany"
    ) {
      nextConfig.sortable = false;
    }
    setDraftConfig(nextConfig);

    // A config change can make previously-shown validation fields disappear
    // (relation cardinality back to `manyToOne`, component `repeatable` off,
    // select `multiple` off - see `field-registry.ts`'s conditional
    // `validationFields`) - drop any values already typed into those now-
    // hidden fields (e.g. a leftover `min`/`max`) rather than saving a stale
    // constraint the user can no longer see or edit.
    const type = fieldTypes[draftType];
    if (type) {
      const allowedKeys = new Set(
        resolveValidationFields(type, nextConfig).map((d) => d.key),
      );
      setDraftValidation((prev) => {
        const next: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (allowedKeys.has(k)) next[k] = v;
        }
        return next;
      });
    }
  }

  function handleValidationChange(key: string, value: unknown) {
    setDraftValidation((prev) => {
      const next: Record<string, unknown> = { ...prev, [key]: value };
      if (draftType === "text") {
        if (key === "regex" && typeof value === "string" && value.length > 0) {
          next.format = "none";
        } else if (key === "format" && value !== "none") {
          next.regex = "";
        }
        const hasRegex =
          typeof next.regex === "string" && next.regex.length > 0;
        const hasMinLength =
          typeof next.minLength === "number" && next.minLength > 0;
        if (hasRegex || hasMinLength) {
          next.required = true;
        }
      }
      return next;
    });
  }

  function setRichTextMode(mode: "content" | "layout" | "inline") {
    setDraftConfig((current) => ({
      ...current,
      inline: mode === "inline",
      layoutContent: mode === "layout",
    }));
  }

  function handleSave() {
    // Surfaces every failing control's own inline error (Type select,
    // Label/Name, select's Options list) instead of a single generic toast -
    // same "attempted" gate `ComponentField.tsx`'s item dialog uses for its
    // own per-field errors, plus the shared "Fix the highlighted fields."
    // summary line below.
    if (readOnly) return;
    setSaveAttempted(true);
    if (!draftType) return;
    if (!draftName.trim()) return;
    if (draftType === "select" && selectOptionsInvalid(draftConfig)) return;
    if (archivedTypeConflict) return;
    onSave(
      {
        // Reusing the archived field's own id (rather than minting a fresh
        // one) is what makes `ContentTypeEditor.tsx`'s `handleFieldSave`
        // restore it in place instead of appending a genuine duplicate -
        // see `archivedFields`' doc comment above.
        id: editingField?.id ?? archivedMatch?.id ?? randomUUID(),
        name: draftName.trim(),
        label: draftLabel.trim() || draftName.trim(),
        description: draftDescription.trim() || undefined,
        type: draftType,
        config: draftConfig,
        validation: draftValidation as FieldValidation,
        default: draftDefault,
        // Placeholder - `ContentTypeEditor`'s `handleFieldSave` immediately
        // renormalizes every field's `order` to its position in `fields[]`
        // right after this fires.
        order: editingField?.order ?? 0,
      },
      draftSide,
    );
  }

  // Case-insensitive name match against the archive, same rule
  // `naming.ts`'s `validateContentTypeDefinition` already enforces for real
  // (a field name is unique across `fields[]`, archived or not) - only
  // meaningful while ADDING (`editingField === null`); renaming an existing
  // field is a separate, unrelated edit this doesn't touch.
  const archivedMatch =
    !editingField && draftName.trim()
      ? archivedFields.find(
          (f) => f.name.toLowerCase() === draftName.trim().toLowerCase(),
        )
      : undefined;
  const archivedTypeConflict =
    !!archivedMatch && !!draftType && archivedMatch.type !== draftType;

  const activeFieldType = fieldTypes[draftType];
  // A `relationmirror` row isn't a real field (see `system-fields.ts`'s
  // `relationMirrorFieldsFor`) - its Label/Name/Type are derived from the
  // `relation` field it mirrors and can't be renamed independently, but its
  // Description and Display side genuinely belong to THIS type and stay
  // editable (see `ContentTypeEditor.tsx`'s `handleFieldSave`).
  const isMirror = editingField?.type === "relationmirror";
  const activeValidationFields = activeFieldType
    ? resolveValidationFields(activeFieldType, draftConfig)
    : [];
  // `readOnly` (a protected field - see `types.ts`'s `protectedFieldIds`)
  // disables every Display/Validation control by disabling every descriptor
  // key at once, reusing the same per-key `disabledKeys` mechanism a normal
  // field's own config already uses for its narrower, situational disables.
  const textDisabledKeys = readOnly
    ? activeValidationFields.map((d) => d.key)
    : draftType === "text"
      ? textValidationDisabledKeys(draftValidation)
      : [];
  const configDisabledKeys = readOnly
    ? (activeFieldType?.configFields ?? []).map((d) => d.key)
    : draftType === "component"
      ? componentConfigDisabledKeys(draftConfig)
      : draftType === "relation"
        ? relationConfigDisabledKeys(draftConfig)
        : [];
  const richTextInline =
    draftType === "richtext" && draftConfig.inline === true;
  const hasSaveErrors =
    saveAttempted &&
    (!draftType ||
      !draftName.trim() ||
      archivedTypeConflict ||
      (draftType === "select" && selectOptionsInvalid(draftConfig)));

  return (
    <dialog
      ref={dialogRef}
      aria-label={editingField ? "Edit field" : "Add field"}
      class="xl field-dialog"
    >
      {open && (
        <>
          <header>
            <h3>{editingField ? "Edit field" : "Add field"}</h3>
          </header>
          {isMirror && (
            <p class="hint" style={{ marginTop: 0 }}>
              This field mirrors a relation field declared on another content
              type - its Label, Name, and Type can't be changed here. Removing
              it (from the Fields list, not here) deletes that relation field
              instead.
            </p>
          )}
          {readOnly && (
            <p class="hint" style={{ marginTop: 0 }}>
              This field is required for login/permissions and can't be changed
              or removed - shown here for reference only.
            </p>
          )}
          <div class="field-dialog-scroll" ref={gridScroll}>
            <div class="field-dialog-grid">
              <div class="stack">
                <SlugField
                  label="Label"
                  slugLabel="Name"
                  placeholder="e.g. Title"
                  slugPlaceholder="e.g. title"
                  required
                  value={draftLabel}
                  slug={draftName}
                  toSlug={slugifyIdentifier}
                  onChange={(label, name) => {
                    setDraftLabel(label);
                    setDraftName(name);
                  }}
                  disabled={isMirror || readOnly}
                  error={
                    saveAttempted && (!draftName.trim() || archivedTypeConflict)
                  }
                  helperText={
                    saveAttempted && !draftName.trim()
                      ? "Field name is required."
                      : saveAttempted && archivedTypeConflict
                        ? `An archived field named "${archivedMatch!.name}" already uses a different type (${fieldTypes[archivedMatch!.type]?.label ?? archivedMatch!.type}) - restore or delete it from the Archive first, or choose a different name.`
                        : archivedMatch
                          ? `Restores the archived "${archivedMatch.label}" field instead of creating a new one.`
                          : undefined
                  }
                />
                <TextField
                  label="Description"
                  multiline
                  placeholder="e.g. Shown as a hint in the entry editor"
                  value={draftDescription}
                  disabled={readOnly}
                  onChange={setDraftDescription}
                />
                <div class="field">
                  <label>
                    Type<span class="required-asterisk">*</span>
                  </label>
                  <Select
                    invalid={saveAttempted && !draftType}
                    options={Object.values(fieldTypes)
                      // `internal` types (e.g. `password`) are seeded onto one
                      // fixed spot by the system, not meant to be picked freely -
                      // but an existing field already of that type (editing, not
                      // adding) still needs to see its own type in the list.
                      .filter((t) => !t.internal || t.key === draftType)
                      .map((t) => ({
                        value: t.key,
                        label: t.label,
                      }))}
                    value={draftType}
                    onChange={(value) => {
                      setDraftType(value);
                      const type = fieldTypes[value];
                      setDraftConfig(type?.defaultConfig ?? {});
                      setDraftValidation(type?.defaultValidation ?? {});
                      setDraftDefault(undefined);
                      setSaveAttempted(false);
                      // Only when adding - editing an existing field already
                      // seeded `draftSide` from its real id/`fieldSides`
                      // above, and the Type select is disabled then anyway.
                      if (!editingField) {
                        setDraftSide(
                          defaultFieldSide(
                            "",
                            value === "relation" || value === "component",
                          ),
                        );
                      }
                    }}
                    disabled={editingField !== null || readOnly}
                  />
                  {saveAttempted && !draftType && (
                    <span class="error">Pick a field type first.</span>
                  )}
                </div>
              </div>

              <div class="stack">
                {!activeFieldType && (
                  <div class="field-dialog-empty-type">
                    Choose a field type to configure its settings.
                  </div>
                )}

                {activeFieldType && (
                  <DefaultValueInput
                    activeType={activeFieldType}
                    config={draftConfig}
                    value={draftDefault}
                    onChange={setDraftDefault}
                    disabled={readOnly}
                  />
                )}

                {activeFieldType &&
                  (showSideToggle ||
                    (activeFieldType.configFields?.length ?? 0) > 0) && (
                    <fieldset>
                      <legend>Display</legend>
                      <div class="stack">
                        {showSideToggle && (
                          <div class="field">
                            <label>Side layout</label>
                            <button
                              type="button"
                              class="outline lg"
                              style={{ justifyContent: "flex-start" }}
                              disabled={
                                readOnly ||
                                (draftType === "richtext" &&
                                  draftConfig.layoutContent === true)
                              }
                              aria-label={
                                draftSide === "left"
                                  ? "Shown on the left - click to move to the right"
                                  : "Shown on the right - click to move to the left"
                              }
                              onClick={() =>
                                setDraftSide((s) =>
                                  s === "left" ? "right" : "left",
                                )
                              }
                            >
                              {draftSide === "left" ? (
                                <SideLeftIcon />
                              ) : (
                                <SideRightIcon />
                              )}
                              {draftSide === "left"
                                ? "Set layout to left"
                                : "Set layout to right"}
                            </button>
                          </div>
                        )}
                        {draftType === "richtext" ? (
                          <div>
                            <div
                              class="file-view-toggle"
                              role="group"
                              aria-label="RichText layout mode"
                            >
                              {(
                                [
                                  ["content", "Content"],
                                  ["layout", "Layout content"],
                                  ["inline", "Inline Field"],
                                ] as const
                              ).map(([mode, label]) => (
                                <button
                                  key={mode}
                                  type="button"
                                  class="ghost sm"
                                  aria-pressed={
                                    mode === "inline"
                                      ? draftConfig.inline === true
                                      : mode === "layout"
                                        ? draftConfig.layoutContent === true
                                        : draftConfig.inline !== true &&
                                          draftConfig.layoutContent !== true
                                  }
                                  disabled={readOnly}
                                  onClick={() => setRichTextMode(mode)}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <SettingsForm
                            descriptors={activeFieldType.configFields ?? []}
                            values={draftConfig}
                            onChange={handleConfigChange}
                            dynamicOptions={dynamicOptions}
                            disabledKeys={configDisabledKeys}
                            showErrors={saveAttempted}
                            outline
                          />
                        )}
                        {(draftType === "relation" ||
                          draftType === "component" ||
                          draftType === "relationmirror") && (
                          <DisplayFieldsInput
                            draftType={draftType}
                            config={draftConfig}
                            allTypes={allTypes}
                            disabled={readOnly}
                            onChange={(value) => handleConfigChange("displayFields", value)}
                          />
                        )}
                      </div>
                    </fieldset>
                  )}

                {activeFieldType &&
                  draftType === "richtext" &&
                  !richTextInline && (
                    <fieldset>
                      <legend>Config</legend>
                      <SettingsForm
                        descriptors={
                          activeFieldType.configFields?.filter(
                            (d) =>
                              d.key !== "inline" && d.key !== "layoutContent",
                          ) ?? []
                        }
                        values={draftConfig}
                        onChange={handleConfigChange}
                        dynamicOptions={dynamicOptions}
                      disabledKeys={configDisabledKeys}
                      outline={false}
                      compactGroups
                    />
                    </fieldset>
                  )}

                {activeFieldType && activeValidationFields.length > 0 && (
                  <fieldset>
                    <legend>Validation</legend>
                    <div class="stack">
                      <SettingsForm
                        descriptors={activeValidationFields}
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
          </div>
          <footer>
            {hasSaveErrors && (
              <em class="error" style={{ marginRight: "auto" }}>
                Fix the highlighted fields.
              </em>
            )}
            {readOnly ? (
              <button type="button" class="outline" onClick={onCancel}>
                Close
              </button>
            ) : (
              <>
                <button type="button" class="outline" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" onClick={handleSave}>
                  Save field
                </button>
              </>
            )}
          </footer>
        </>
      )}
    </dialog>
  );
}
