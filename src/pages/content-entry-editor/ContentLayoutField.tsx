import RichTextField from "../../components/RichTextField.js";
import type { EntryColumnNode } from "../../content-types/engine/entry-tree.js";
import type { RichTextFieldConfig } from "../../content-types/field-registry.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";

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
 * makes this its own fixed-height, independently-scrolling pane (Keystatic-
 * style split view) - `useOverlayScrollbars` here is the same scrollbar
 * library/theme every other scrollable region in the app already uses
 * (`DryLayout.tsx`'s `.main`, `DataTable.tsx`), rather than a plain native
 * `overflow: auto`. The toolbar (`.richtext-toolbar`) stays
 * `position: sticky; top: 0` against the scrollbar's own generated
 * `.os-viewport` - see the `overflow: visible` override on `.richtext`
 * in components.css for why that's required (an `overflow: hidden`
 * ancestor between a sticky element and its real scrolling ancestor breaks
 * the stickiness).
 */
export default function ContentLayoutField({ node, value, onChange, error }: ContentLayoutFieldProps) {
  const config = node.fieldConfig as RichTextFieldConfig | undefined;
  const scroll = useOverlayScrollbars<HTMLDivElement>();
  return (
    <div class="content-layout-field" data-field-name={node.fieldName} ref={scroll.ref}>
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
