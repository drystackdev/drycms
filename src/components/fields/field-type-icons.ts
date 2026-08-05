/**
 * Icon per field-input type, keyed by the same id used in
 * `mock/showcase.ts`'s "Field inputs" group and by
 * `FieldTypeDefinition.key` in `content-types/field-registry.ts` where a
 * registered type exists. Shared so any UI listing field types (showcase
 * nav, schema editor's type picker, ...) can render a consistent icon.
 */
import type { ComponentType } from "preact";
import {
  type IconProps,
  TextFieldTypeIcon,
  CodeFieldTypeIcon,
  RichTextFieldTypeIcon,
  SlugFieldTypeIcon,
  PasswordFieldTypeIcon,
  SecretFieldTypeIcon,
  NumberFieldTypeIcon,
  CheckFieldTypeIcon,
  SelectFieldTypeIcon,
  DatePickerFieldTypeIcon,
  ImageFieldTypeIcon,
  RelationFieldTypeIcon,
  ComponentFieldTypeIcon,
} from "../icons/index.js";

export const fieldTypeIcons: Record<string, ComponentType<IconProps>> = {
  "text-field": TextFieldTypeIcon,
  text: TextFieldTypeIcon,
  "code-field": CodeFieldTypeIcon,
  code: CodeFieldTypeIcon,
  "richtext-field": RichTextFieldTypeIcon,
  richtext: RichTextFieldTypeIcon,
  "slug-field": SlugFieldTypeIcon,
  slug: SlugFieldTypeIcon,
  "password-field": PasswordFieldTypeIcon,
  password: PasswordFieldTypeIcon,
  "secret-field": SecretFieldTypeIcon,
  secretkey: SecretFieldTypeIcon,
  "number-field": NumberFieldTypeIcon,
  number: NumberFieldTypeIcon,
  "check-field": CheckFieldTypeIcon,
  boolean: CheckFieldTypeIcon,
  "select-field": SelectFieldTypeIcon,
  select: SelectFieldTypeIcon,
  "date-picker-field": DatePickerFieldTypeIcon,
  date: DatePickerFieldTypeIcon,
  "image-field": ImageFieldTypeIcon,
  image: ImageFieldTypeIcon,
  "relation-field": RelationFieldTypeIcon,
  relation: RelationFieldTypeIcon,
  "component-field": ComponentFieldTypeIcon,
  component: ComponentFieldTypeIcon,
  // No dedicated icon - a mirror row is just a read/write view over the
  // other side's `relation` field (see `system-fields.ts`'s
  // `relationMirrorFieldsFor`), so it borrows that icon.
  relationmirror: RelationFieldTypeIcon,
};

/**
 * One accent color per field-input type, keyed the same way as
 * `fieldTypeIcons` above - purely a visual distinguisher for scanning a
 * fields list at a glance (e.g. `FieldListItem`), not drawn from the
 * `--dry-*` design-token palette since these need many more distinct, stable
 * hues than the system palette provides.
 */
export const fieldTypeColors: Record<string, string> = {
  "text-field": "#3b82f6",
  text: "#3b82f6",
  "code-field": "#64748b",
  code: "#64748b",
  "richtext-field": "#8b5cf6",
  richtext: "#8b5cf6",
  "slug-field": "#06b6d4",
  slug: "#06b6d4",
  "password-field": "#ef4444",
  password: "#ef4444",
  "secret-field": "#e11d48",
  secretkey: "#e11d48",
  "number-field": "#f59e0b",
  number: "#f59e0b",
  "check-field": "#22c55e",
  boolean: "#22c55e",
  "select-field": "#a855f7",
  select: "#a855f7",
  "date-picker-field": "#14b8a6",
  date: "#14b8a6",
  "image-field": "#ec4899",
  image: "#ec4899",
  "relation-field": "#6366f1",
  relation: "#6366f1",
  "component-field": "#eab308",
  component: "#eab308",
  relationmirror: "#6366f1",
};
