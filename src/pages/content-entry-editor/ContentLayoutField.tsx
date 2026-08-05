import RichTextField from "../../components/RichTextField.js";
import type { EntryColumnNode } from "../../content-types/engine/entry-tree.js";
import type { RichTextFieldConfig } from "../../content-types/field-registry.js";

interface ContentLayoutFieldProps {
  node: EntryColumnNode;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

/**
 * A richtext field marked "Layout content" (the FieldDialog's Content /
 * Layout content toggle - see `RichTextFieldConfig.layoutContent`) IS the
 * entry's main body, not one labeled field among others - `ContentEntryEditor`
 * renders this instead of the normal `.stack` of fields for its whole left
 * column whenever such a field is present (see its `layoutContentFields`).
 * `.content-layout-field` (components.css) drops the label/description and
 * gives the editor a generous min-height so it reads as a full document
 * surface - deliberately only a MIN, not a fixed height: the actual
 * contenteditable area stays intrinsically sized (see
 * `content-shadow-styles.ts`'s doc comment on why `height: 100%` there only
 * activates against a definite ancestor height), so normal page scroll
 * (the admin shell's sticky `.topbar` + scrolling `.content`, not a nested
 * scrollbox) still handles anything taller than the viewport.
 */
export default function ContentLayoutField({ node, value, onChange, error }: ContentLayoutFieldProps) {
  const config = node.fieldConfig as RichTextFieldConfig | undefined;
  return (
    <div class="content-layout-field" data-field-name={node.fieldName}>
      <RichTextField
        label={node.label}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        features={config}
        required={!!node.validation.required}
        error={!!error}
        helperText={error}
        hideLabel
      />
    </div>
  );
}
