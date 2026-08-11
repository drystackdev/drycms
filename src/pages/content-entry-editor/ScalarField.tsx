import { useMemo } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import CheckField from "../../components/fields/CheckField.js";
import DatePickerField, { type DatePickerMode } from "../../components/fields/DatePickerField.js";
import { createHttpFileSource } from "../../storage/http-source.js";
import FileField from "../../components/fields/FileField.js";
import ImageField from "../../components/fields/ImageField.js";
import NumberField from "../../components/fields/NumberField.js";
import SecretKeyField from "../../components/fields/SecretKeyField.js";
import SelectField from "../../components/fields/SelectField.js";
import TextField from "../../components/fields/TextField.js";
import type { MaskedValue } from "../../content-types/engine/entry-codec.js";
import type { EntryColumnNode } from "../../content-types/engine/entry-tree.js";
import type { FileFieldConfig, ImageFieldConfig, SelectFieldConfig } from "../../content-types/field-registry.js";
import type { RichTextFieldConfig } from "../../content-types/field-registry.js";
import RichTextField from "../../components/RichTextField.js";
import PasswordChangeField from "./PasswordChangeField.js";
import { useEntryMediaSource } from "./entry-media-context.js";

interface Props {
  node: EntryColumnNode;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

function isMaskedValue(value: unknown): value is MaskedValue {
  return typeof value === "object" && value !== null && "hasExisting" in (value as Record<string, unknown>);
}

/**
 * Renders one `column`-shaped field's editor - dispatches on `fieldType` to
 * the same `Editor` components `field-registry.ts` declares for each type
 * (`SelectField`/`DatePickerField`/etc.), matching each one's own extra-prop
 * contract. `password` has no registry `Editor` at all (schema-definition-
 * only there); this builds a small bespoke masked input for it instead,
 * following `SecretKeyField`'s "blank means keep the current value" pattern.
 */
export default function ScalarField({ node, value, onChange, error }: Props) {
  const { fieldType, label, description, validation } = node;
  const config = (node.fieldConfig ?? {}) as Record<string, unknown>;
  // Called unconditionally (rules of hooks) even though only the
  // `image`/`file`/`richtext` branches below actually use them.
  const imageSource = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);
  const entrySource = useEntryMediaSource(imageSource);

  if (fieldType === "password") {
    const masked: MaskedValue = isMaskedValue(value) ? value : { hasExisting: false };
    return (
      <PasswordChangeField
        label={label}
        description={description}
        value={masked}
        onChange={onChange}
        required={!!validation.required}
        error={error}
      />
    );
  }

  if (fieldType === "secretkey") {
    const masked = isMaskedValue(value) ? value : { hasExisting: false };
    return (
      <SecretKeyField
        label={label}
        description={description}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        hasExistingValue={masked.hasExisting}
        required={!!validation.required}
        error={!!error}
        helperText={error}
      />
    );
  }

  if (fieldType === "text") {
    return (
      <TextField
        label={label}
        description={description}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        multiline={!!config.multiline}
        placeholder={config.placeholder as string | undefined}
        required={!!validation.required}
        error={!!error}
        helperText={error}
      />
    );
  }

  if (fieldType === "richtext") {
    const richTextConfig = config as RichTextFieldConfig;
    return (
      <RichTextField
        label={label}
        description={description}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        inline={richTextConfig.inline === true}
        features={richTextConfig.inline === false ? richTextConfig : undefined}
        required={!!validation.required}
        error={!!error}
        helperText={error}
        source={imageSource}
        entrySource={entrySource}
      />
    );
  }

  if (fieldType === "number") {
    return (
      <NumberField
        label={label}
        description={description}
        value={typeof value === "number" ? value : 0}
        onChange={onChange}
        min={validation.min as number | undefined}
        max={validation.max as number | undefined}
        step={(config.step as number | undefined) ?? 1}
        required={!!validation.required}
        error={!!error}
        helperText={error}
      />
    );
  }

  if (fieldType === "boolean") {
    return (
      <CheckField
        label={label}
        description={description}
        value={typeof value === "boolean" ? value : false}
        onChange={onChange}
        role={config.ui === "switch" ? "switch" : "checkbox"}
        error={!!error}
        helperText={error}
        outline
      />
    );
  }

  if (fieldType === "date") {
    const dateValue = value instanceof Date ? value : typeof value === "string" && value ? new Date(value) : new Date();
    return (
      <DatePickerField
        label={label}
        description={description}
        value={dateValue}
        onChange={onChange}
        mode={config.mode as DatePickerMode | undefined}
        time={!!config.time}
        min={validation.min as Date | undefined}
        max={validation.max as Date | undefined}
        required={!!validation.required}
        error={!!error}
        helperText={error}
      />
    );
  }

  if (fieldType === "image") {
    const imageConfig = config as unknown as ImageFieldConfig;
    const multiple = !!imageConfig.multiple;
    return (
      <ImageField
        label={label}
        description={description}
        value={
          multiple
            ? Array.isArray(value)
              ? value
              : value
                ? [value as string]
                : []
            : typeof value === "string"
              ? value
              : ""
        }
        onChange={onChange}
        source={imageSource}
        entrySource={entrySource}
        multiple={multiple ? { min: validation.min as number | undefined, max: validation.max as number | undefined } : false}
        required={!!validation.required}
        error={!!error}
        helperText={error}
      />
    );
  }

  if (fieldType === "file") {
    const fileConfig = config as unknown as FileFieldConfig;
    const multiple = !!fileConfig.multiple;
    return (
      <FileField
        label={label}
        description={description}
        value={
          multiple
            ? Array.isArray(value)
              ? value
              : value
                ? [value as string]
                : []
            : typeof value === "string"
              ? value
              : ""
        }
        onChange={onChange}
        source={imageSource}
        entrySource={entrySource}
        accept={fileConfig.accept ? fileConfig.accept.split(",").map((s) => s.trim()).filter(Boolean) : undefined}
        multiple={multiple ? { min: validation.min as number | undefined, max: validation.max as number | undefined } : false}
        required={!!validation.required}
        error={!!error}
        helperText={error}
      />
    );
  }

  if (fieldType === "select") {
    const selectConfig = config as unknown as SelectFieldConfig;
    return (
      <SelectField
        label={label}
        description={description}
        value={(value as string | string[] | undefined) ?? (selectConfig.multiple ? [] : "")}
        onChange={onChange}
        config={selectConfig}
        required={!!validation.required}
        error={!!error}
        helperText={error}
      />
    );
  }

  return (
    <div class="field">
      <label>{label}</label>
      <span class="hint">Unsupported field type "{fieldType}".</span>
    </div>
  );
}
