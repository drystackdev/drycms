import type { ComponentType } from "preact";
import CheckField from "../components/CheckField.js";
import DatePickerField from "../components/DatePickerField.js";
import ImageField from "../components/ImageField.js";
import NumberField from "../components/NumberField.js";
import TextField from "../components/TextField.js";

export type FieldShape = "column" | "flatten" | "child-table";
export type SqlColumnType = "TEXT" | "INTEGER" | "REAL";

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingDescriptor {
  key: string;
  label: string;
  widget: "boolean" | "text" | "number" | "select";
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
  /**
   * Whether a `column`-shaped instance of this type should be folded into
   * its table's FTS5 index. Defaults to `sqlType(config) === 'TEXT'` when
   * omitted - true for `text` by that default; `date`/`image` are both TEXT
   * but not prose, so they override to `false`.
   */
  fts?: boolean | ((config: unknown) => boolean);
  /** Drives the "Add Field" dialog's per-type settings form: one shared
   * form component renders these descriptors (via `CheckField`/`TextField`/
   * `NumberField`/`Select`) instead of hand-building a bespoke settings
   * form per type. `configFields` write into `FieldDefinition.config`;
   * `validationFields` write into `FieldDefinition.validation`. */
  configFields?: SettingDescriptor[];
  validationFields?: SettingDescriptor[];
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

export function resolveFts(def: FieldTypeDefinition, config: Record<string, unknown>): boolean {
  if (typeof def.fts === "function") return def.fts(config);
  if (typeof def.fts === "boolean") return def.fts;
  return def.sqlType?.(config) === "TEXT";
}

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
  fts: false,
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
  fts: false,
  configFields: [],
  validationFields: [{ key: "required", label: "Required", widget: "boolean" }],
};

export const passwordFieldType: FieldTypeDefinition<string> = {
  key: "password",
  label: "Password",
  shape: "column",
  // No Editor: like relation/component, this is schema-definition-only until
  // content-entry editing exists - and even then, a password's own hashing/
  // entry UI wouldn't reuse the plain-text `TextField` editor.
  sqlType: () => "TEXT",
  // Never folded into FTS, regardless of the `sqlType() === 'TEXT'` default -
  // a password column must never end up in a searchable index.
  fts: false,
  internal: true,
  configFields: [],
  validationFields: [{ key: "required", label: "Required", widget: "boolean" }],
};

export interface RelationFieldConfig {
  /** Another `ContentTypeDefinition.id` (kind `'collection'`). */
  target: string;
  cardinality: "one" | "many";
}

export const relationFieldType: FieldTypeDefinition = {
  key: "relation",
  label: "Relation",
  shape: (config) => ((config as RelationFieldConfig).cardinality === "many" ? "child-table" : "column"),
  // Only consulted when cardinality is 'one' (resolved shape 'column') -
  // stores the target row's `id`.
  sqlType: () => "INTEGER",
  fts: false,
  configFields: [
    { key: "target", label: "Target collection", widget: "select", optionsSource: "collections" },
    {
      key: "cardinality",
      label: "Cardinality",
      widget: "select",
      options: [
        { value: "one", label: "One" },
        { value: "many", label: "Many" },
      ],
    },
  ],
  validationFields: [],
};

export interface ComponentFieldConfig {
  /** Another `ContentTypeDefinition.id` (kind `'component'`). */
  componentId: string;
  repeatable: boolean;
}

export const componentFieldType: FieldTypeDefinition = {
  key: "component",
  label: "Component",
  shape: (config) => ((config as ComponentFieldConfig).repeatable ? "child-table" : "flatten"),
  // No sqlType: 'flatten'/'child-table' shapes never call it.
  configFields: [
    { key: "componentId", label: "Component", widget: "select", optionsSource: "components" },
    { key: "repeatable", label: "Repeatable", widget: "boolean" },
  ],
  validationFields: [],
};

export const fieldTypes: Record<string, FieldTypeDefinition<any>> = {
  [textFieldType.key]: textFieldType,
  [numberFieldType.key]: numberFieldType,
  [booleanFieldType.key]: booleanFieldType,
  [dateFieldType.key]: dateFieldType,
  [imageFieldType.key]: imageFieldType,
  [passwordFieldType.key]: passwordFieldType,
  [relationFieldType.key]: relationFieldType,
  [componentFieldType.key]: componentFieldType,
};
