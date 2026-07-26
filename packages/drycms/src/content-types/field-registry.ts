import type { ComponentType } from "preact";
import CheckField from "../components/CheckField.js";
import DatePickerField from "../components/DatePickerField.js";
import ImageField from "../components/ImageField.js";
import NumberField from "../components/NumberField.js";
import TextField from "../components/TextField.js";

export type FieldShape = "column" | "flatten" | "child-table";
export type SqlColumnType = "TEXT" | "INTEGER" | "REAL";

export interface FieldTypeDefinition<V = unknown> {
  key: string;
  label: string;
  shape: FieldShape;
  /**
   * Each Editor needs a different extra-prop shape beyond `FieldProps<V>`
   * (per-field `config`, or injected context like ImageField's `source`),
   * so this stays loosely typed rather than forcing one generic signature.
   */
  Editor: ComponentType<any>;
  sqlType?: (config: Record<string, unknown>) => SqlColumnType;
  serialize?: (value: V) => unknown;
  deserialize?: (raw: unknown) => V;
}

export const textFieldType: FieldTypeDefinition<string> = {
  key: "text",
  label: "Text",
  shape: "column",
  Editor: TextField,
  sqlType: () => "TEXT",
};

export const numberFieldType: FieldTypeDefinition<number> = {
  key: "number",
  label: "Number",
  shape: "column",
  Editor: NumberField,
  sqlType: () => "REAL",
};

export const booleanFieldType: FieldTypeDefinition<boolean> = {
  key: "boolean",
  label: "Boolean",
  shape: "column",
  Editor: CheckField,
  sqlType: () => "INTEGER",
  serialize: (value) => (value ? 1 : 0),
  deserialize: (raw) => raw === 1 || raw === true,
};

export const dateFieldType: FieldTypeDefinition<Date> = {
  key: "date",
  label: "Date",
  shape: "column",
  Editor: DatePickerField,
  sqlType: () => "TEXT",
  serialize: (value) => value.toISOString(),
  deserialize: (raw) => new Date(raw as string),
};

export const imageFieldType: FieldTypeDefinition<string> = {
  key: "image",
  label: "Image",
  shape: "column",
  Editor: ImageField,
  sqlType: () => "TEXT",
};

export const fieldTypes: Record<string, FieldTypeDefinition<any>> = {
  [textFieldType.key]: textFieldType,
  [numberFieldType.key]: numberFieldType,
  [booleanFieldType.key]: booleanFieldType,
  [dateFieldType.key]: dateFieldType,
  [imageFieldType.key]: imageFieldType,
};
