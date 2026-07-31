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
} from "./icons.js";

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
};
