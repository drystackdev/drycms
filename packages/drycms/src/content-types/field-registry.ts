import type { ComponentType } from "preact";
import CheckField from "../components/CheckField.js";
import DatePickerField from "../components/DatePickerField.js";
import ImageField from "../components/ImageField.js";
import NumberField from "../components/NumberField.js";
import SecretKeyField from "../components/SecretKeyField.js";
import SelectField from "../components/SelectField.js";
import TextField from "../components/TextField.js";

export type FieldShape = "column" | "flatten" | "child-table" | "virtual";
export type SqlColumnType = "TEXT" | "INTEGER" | "REAL";

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingDescriptor {
  key: string;
  label: string;
  widget: "boolean" | "text" | "number" | "select" | "option-list";
  /** `select` widget only. Either a fixed option list, or a marker telling
   * the "Add Field" form to populate options from the OTHER content types
   * that currently exist (`relation`'s `target`, `component`'s
   * `componentId`) - not knowable statically by the registry itself. */
  options?: SettingOption[];
  optionsSource?: "collections" | "components";
}

export interface FieldTypeDefinition<V = unknown> {
  key: string;
  label: string;
  /**
   * Fixed for the 5 scalar types; a function for types whose physical
   * layout depends on their own `config` (`relation`, `component`). Always
   * go through `resolveFieldShape()` rather than reading `.shape` directly.
   */
  shape: FieldShape | ((config: unknown) => FieldShape);
  /**
   * Each Editor needs a different extra-prop shape beyond `FieldProps<V>`
   * (per-field `config`, or injected context like ImageField's `source`),
   * so this stays loosely typed rather than forcing one generic signature.
   * Absent for `relation`/`component`: those are schema-definition-only in
   * this pass (no content-entry editing UI exists yet).
   */
  Editor?: ComponentType<any>;
  /** Only consulted when the resolved shape is `'column'`. */
  sqlType?: (config: Record<string, unknown>) => SqlColumnType;
  serialize?: (value: V) => unknown;
  deserialize?: (raw: unknown) => V;
  /** Drives the "Add Field" dialog's per-type settings form: one shared
   * form component renders these descriptors (via `CheckField`/`TextField`/
   * `NumberField`/`Select`) instead of hand-building a bespoke settings
   * form per type. `configFields` write into `FieldDefinition.config`;
   * `validationFields` write into `FieldDefinition.validation`. */
  configFields?: SettingDescriptor[];
  /**
   * Fixed for most types; a function for types whose available validation
   * rules depend on their own `config` - `relation`'s min/max item count only
   * means anything once `cardinality` is multi-valued, `component`'s once
   * `repeatable` is on, `select`'s once `multiple` is on. Always go through
   * `resolveValidationFields()` rather than reading `.validationFields`
   * directly.
   */
  validationFields?: SettingDescriptor[] | ((config: unknown) => SettingDescriptor[]);
  /** Seeded into `draftConfig`/`draftValidation` when this type is picked in
   * the "Add Field" dialog (replacing the previous unconditional reset to
   * `{}`), so a type can declare sensible defaults - e.g. `number`'s `step`
   * defaulting to 1 - without the dialog special-casing individual types. */
  defaultConfig?: Record<string, unknown>;
  defaultValidation?: Record<string, unknown>;
  /** Excluded from the "Add Field" type picker (`FieldDialog`'s `<Select>`)
   * - reserved for fields the system itself seeds onto one fixed spot (e.g.
   * `password` on the built-in `user` collection, see `seed.ts`) rather than
   * a type meant to be picked freely on arbitrary content types. An existing
   * field of an internal type still renders/edits normally. */
  internal?: boolean;
}

const REQUIRED_UNIQUE_VALIDATION: SettingDescriptor[] = [
  { key: "required", label: "Required", widget: "boolean" },
  { key: "unique", label: "Unique", widget: "boolean" },
];

export function resolveFieldShape(def: FieldTypeDefinition, config: unknown): FieldShape {
  return typeof def.shape === "function" ? def.shape(config) : def.shape;
}

export function resolveValidationFields(def: FieldTypeDefinition, config: unknown): SettingDescriptor[] {
  return typeof def.validationFields === "function" ? def.validationFields(config) : (def.validationFields ?? []);
}

/** Shared `min`/`max` item-count descriptors for the 3 field types whose
 * `validationFields` become count-limited only once their own config makes
 * them multi-valued (`relation`'s non-`manyToOne` cardinality, `component`'s
 * `repeatable`, `select`'s `multiple`) - see each type's `validationFields`
 * below and `entry-validate.ts`'s count check that enforces them. */
const ITEM_COUNT_VALIDATION: SettingDescriptor[] = [
  { key: "min", label: "Min items", widget: "number" },
  { key: "max", label: "Max items", widget: "number" },
];

export const textFieldType: FieldTypeDefinition<string> = {
  key: "text",
  label: "Text",
  shape: "column",
  Editor: TextField,
  sqlType: () => "TEXT",
  configFields: [
    { key: "multiline", label: "Multiline (textarea)", widget: "boolean" },
    { key: "placeholder", label: "Placeholder", widget: "text" },
  ],
  // minLength/maxLength/regex are server-side only (TextField has no
  // matching UI prop yet) - still real validation rules, just not reflected
  // in the Editor itself. `regex` and `format` are mutually exclusive, and
  // either `regex` or `minLength` forces `required` on - enforced by the
  // Add/Edit Field dialog (not here; this registry stays declarative).
  validationFields: [
    ...REQUIRED_UNIQUE_VALIDATION,
    { key: "minLength", label: "Min length", widget: "number" },
    { key: "maxLength", label: "Max length", widget: "number" },
    { key: "regex", label: "Regex", widget: "text" },
    {
      key: "format",
      label: "Format",
      widget: "select",
      options: [
        { value: "none", label: "None" },
        { value: "email", label: "Email" },
        { value: "url", label: "URL" },
        { value: "slug", label: "Slug" },
      ],
    },
  ],
};

export const numberFieldType: FieldTypeDefinition<number> = {
  key: "number",
  label: "Number",
  shape: "column",
  Editor: NumberField,
  sqlType: () => "REAL",
  configFields: [{ key: "step", label: "Step", widget: "number" }],
  defaultConfig: { step: 1 },
  validationFields: [
    ...REQUIRED_UNIQUE_VALIDATION,
    { key: "min", label: "Min", widget: "number" },
    { key: "max", label: "Max", widget: "number" },
  ],
};

export const booleanFieldType: FieldTypeDefinition<boolean> = {
  key: "boolean",
  label: "Boolean",
  shape: "column",
  Editor: CheckField,
  sqlType: () => "INTEGER",
  serialize: (value) => (value ? 1 : 0),
  deserialize: (raw) => raw === 1 || raw === true,
  configFields: [
    {
      key: "ui",
      label: "Style",
      widget: "select",
      options: [
        { value: "checkbox", label: "Checkbox" },
        { value: "switch", label: "Switch" },
      ],
    },
  ],
  // No required/unique: a boolean column always has a value either way.
  validationFields: [],
};

export const dateFieldType: FieldTypeDefinition<Date> = {
  key: "date",
  label: "Date",
  shape: "column",
  Editor: DatePickerField,
  sqlType: () => "TEXT",
  // `value` is a `Date` when serializing a live entry, but a plain ISO
  // string when it arrives as a `FieldDefinition.default` that already
  // round-tripped through JSON (see `migration.ts`'s `defaultLiteralFor`).
  serialize: (value) => (value instanceof Date ? value : new Date(value)).toISOString(),
  deserialize: (raw) => new Date(raw as string),
  configFields: [
    {
      key: "mode",
      label: "Picker style",
      widget: "select",
      options: [
        { value: "calendar", label: "Calendar" },
        { value: "select", label: "Day/Month/Year dropdowns" },
        { value: "input", label: "Native input" },
      ],
    },
    { key: "time", label: "Include time of day", widget: "boolean" },
  ],
  validationFields: REQUIRED_UNIQUE_VALIDATION,
};

export const imageFieldType: FieldTypeDefinition<string> = {
  key: "image",
  label: "Image",
  shape: "column",
  Editor: ImageField,
  sqlType: () => "TEXT",
  // `isAvatar` only affects read-only display (the List page's cell
  // renderer - see `ContentEntryList.tsx`), not `ImageField` itself: the
  // picker frame stays the same 4:3 box either way.
  configFields: [{ key: "isAvatar", label: "Show as a circular avatar in lists", widget: "boolean" }],
  validationFields: [{ key: "required", label: "Required", widget: "boolean" }],
};

export interface SelectFieldConfig {
  /** Fixed value set defined when the field itself is created - not editable
   * per-entry, only here in the schema. Each option is a single bare string,
   * used as both the stored value and the display label (no separate
   * machine-value-vs-label pair to fill in). */
  options: string[];
  /** @default false - a single `Select`; `true` renders a `MultiSelect` and
   * the stored value becomes a JSON-encoded array instead of a bare string. */
  multiple: boolean;
}

export const selectFieldType: FieldTypeDefinition<string | string[]> = {
  key: "select",
  label: "Select",
  shape: "column",
  Editor: SelectField,
  // TEXT either way: a bare option value in single mode, a JSON-encoded array
  // of them in multiple mode.
  sqlType: () => "TEXT",
  serialize: (value) => (Array.isArray(value) ? JSON.stringify(value) : value),
  deserialize: (raw) => {
    if (typeof raw !== "string") return raw as string | string[];
    if (raw.startsWith("[")) {
      try {
        return JSON.parse(raw) as string[];
      } catch {
        return raw;
      }
    }
    return raw;
  },
  configFields: [
    { key: "options", label: "Options", widget: "option-list" },
    { key: "multiple", label: "Allow multiple values", widget: "boolean" },
  ],
  defaultConfig: { options: [], multiple: false },
  // Min/max item count only means anything once `multiple` is on - a
  // single-value select has exactly 0 or 1 selections either way.
  validationFields: (config) => [
    { key: "required", label: "Required", widget: "boolean" },
    ...((config as SelectFieldConfig).multiple ? ITEM_COUNT_VALIDATION : []),
  ],
};

export const passwordFieldType: FieldTypeDefinition<string> = {
  key: "password",
  label: "Password",
  shape: "column",
  // No Editor: like relation/component, this is schema-definition-only until
  // content-entry editing exists - and even then, a password's own hashing/
  // entry UI wouldn't reuse the plain-text `TextField` editor.
  sqlType: () => "TEXT",
  internal: true,
  configFields: [],
  validationFields: [{ key: "required", label: "Required", widget: "boolean" }],
};

export type RelationCardinality = "manyToOne" | "oneToMany" | "manyToMany";

export const secretKeyFieldType: FieldTypeDefinition<string> = {
  key: "secretkey",
  label: "Secret Key",
  shape: "column",
  // Unlike `password` (hashed, login-only, internal), a secret key is meant
  // to be added freely to any collection (e.g. a third-party API key) - not
  // `internal`. This Editor is write-only/masked (see `SecretKeyField.tsx`)
  // and, same as `password`, isn't wired anywhere yet (no entry-CRUD UI
  // exists). Encryption itself lives in `lib/secret-crypto.ts`'s
  // `encryptSecret`/`decryptSecret` rather than this type's `serialize`/
  // `deserialize` - those are synchronous, but Web Crypto (needed so this
  // works on the D1/Workers content engine too, not just Node/Bun sqlite) is
  // inherently async. A future entry-CRUD write/read path is expected to
  // `await` them directly instead.
  Editor: SecretKeyField,
  sqlType: () => "TEXT",
  configFields: [],
  validationFields: [{ key: "required", label: "Required", widget: "boolean" }],
};

export interface RelationFieldConfig {
  /** Another `ContentTypeDefinition.id` (kind `'collection'`). */
  target: string;
  /**
   * `manyToOne` (n→1): many rows here each point to one target row - stored
   * as a plain `target_id` INTEGER column on this table (`shape: 'column'`).
   * `oneToMany` (1→n): each target row is claimed by at most one row here -
   * a child table like `manyToMany`'s, but its `target_id` column carries a
   * UNIQUE constraint (see `tree.ts`'s `buildRelationChildTable`) so a target
   * can't be claimed twice.
   * `manyToMany` (n↔n): rows here and target rows can link freely in either
   * direction - the same child-table shape as `oneToMany`, just without the
   * uniqueness constraint.
   */
  cardinality: RelationCardinality;
}

export const relationFieldType: FieldTypeDefinition = {
  key: "relation",
  label: "Relation",
  shape: (config) => ((config as RelationFieldConfig).cardinality === "manyToOne" ? "column" : "child-table"),
  // Only consulted when cardinality is 'manyToOne' (resolved shape 'column') -
  // stores the target row's `id`.
  sqlType: () => "INTEGER",
  configFields: [
    { key: "target", label: "Target collection", widget: "select", optionsSource: "collections" },
    {
      key: "cardinality",
      label: "Cardinality",
      widget: "select",
      options: [
        { value: "manyToOne", label: "[n - 1] One target per entry — many entries can share the same target" },
        { value: "oneToMany", label: "[1 - n] Many targets per entry — but each target belongs to only one entry" },
        { value: "manyToMany", label: "[n - n] Entries and targets can link to each other freely" },
      ],
    },
  ],
  defaultConfig: { target: "", cardinality: "manyToOne" },
  // Min/max item count only means anything once cardinality is multi-valued
  // (`oneToMany`/`manyToMany`) - `manyToOne` stores a single target, nothing
  // to count-limit.
  validationFields: (config) =>
    (config as RelationFieldConfig).cardinality !== "manyToOne" ? ITEM_COUNT_VALIDATION : [],
};

export interface ComponentFieldConfig {
  /** Another `ContentTypeDefinition.id` (kind `'component'`). */
  componentId: string;
  repeatable: boolean;
  /** Only meaningful when `repeatable` is on - lets the entry editor's item
   * list (`components/ComponentField.tsx`) be manually drag-reordered.
   * Meaningless (and kept disabled/cleared - see `FieldDialog.tsx`) on a
   * non-repeatable component, which only ever has the one inline instance. */
  sortable?: boolean;
}

export const componentFieldType: FieldTypeDefinition = {
  key: "component",
  label: "Component",
  shape: (config) => ((config as ComponentFieldConfig).repeatable ? "child-table" : "flatten"),
  // No sqlType: 'flatten'/'child-table' shapes never call it.
  configFields: [
    { key: "componentId", label: "Component", widget: "select", optionsSource: "components" },
    { key: "repeatable", label: "Repeatable", widget: "boolean" },
    { key: "sortable", label: "Sortable (drag to reorder items)", widget: "boolean" },
  ],
  // Min/max item count only means anything once `repeatable` is on - a
  // non-repeatable component only ever has the one inline instance.
  validationFields: (config) => ((config as ComponentFieldConfig).repeatable ? ITEM_COUNT_VALIDATION : []),
};

export interface RelationMirrorFieldConfig {
  /** Another `ContentTypeDefinition.id` that owns the REAL `relation` field
   * being mirrored - may equal the id of the type this mirror field is
   * itself declared on (a self-relation, e.g. `Employee.manager` mirrored
   * back as `Employee.directReports`). */
  sourceTypeId: string;
  /** `FieldDefinition.id` (not name) of the `relation`-type field on
   * `sourceTypeId` that targets THIS type. The target is implicit here
   * (always "whichever type this mirror field lives on"), unlike
   * `RelationFieldConfig`, which declares `target` explicitly. */
  sourceFieldId: string;
}

/**
 * `internal: true` - never appears in the "Add Field" type picker.
 * `relationmirror` fields are auto-generated, not hand-added: every
 * `relation` field anywhere that targets a given collection gets a matching
 * mirror field synthesized onto that collection automatically (see
 * `system-fields.ts`'s `relationMirrorFieldsFor`, injected in
 * `entry-tree.ts`'s `buildEntryFieldTree` and `ContentTypeEditor.tsx`'s
 * `systemFieldsForUi`) - appears/disappears with the relation itself, same
 * as `id`/`createdAt`/other synthetic fields, rather than being a real entry
 * in anyone's `fields[]`. No column, no child table either way - see
 * `tree.ts`'s `walk()`. The mirrored relation's own cardinality/data lives
 * entirely on `sourceTypeId`'s side; this field is a read/write view over
 * it, never physical storage of its own (see `entry-tree.ts`'s
 * `buildRelationMirrorNode`).
 */
export const relationMirrorFieldType: FieldTypeDefinition = {
  key: "relationmirror",
  label: "Relation Mirror",
  shape: "virtual",
  internal: true,
  configFields: [],
  validationFields: [],
};

export const fieldTypes: Record<string, FieldTypeDefinition<any>> = {
  [textFieldType.key]: textFieldType,
  [numberFieldType.key]: numberFieldType,
  [booleanFieldType.key]: booleanFieldType,
  [dateFieldType.key]: dateFieldType,
  [imageFieldType.key]: imageFieldType,
  [selectFieldType.key]: selectFieldType,
  [passwordFieldType.key]: passwordFieldType,
  [secretKeyFieldType.key]: secretKeyFieldType,
  [relationFieldType.key]: relationFieldType,
  [componentFieldType.key]: componentFieldType,
  [relationMirrorFieldType.key]: relationMirrorFieldType,
};
