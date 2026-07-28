import type { SerializedEditorState } from "lexical";
import type { FieldProps } from "../field-common.js";
import type { FileManagerSource } from "../file-manager-types.js";
import RichTextToolbar from "./toolbar.js";
import { useRichTextEditor } from "./useRichTextEditor.js";

export interface RichTextFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  /** Where the toolbar's "Insert image" button reads its files from - the
   * button (and the picker dialog behind it) only exists when this is set,
   * same optionality as `ImageField`'s own `source` prop. */
  source?: FileManagerSource;
  /** Lexical's serialized editor state, as an object rather than a JSON
   * string - reported on every change alongside `value` (always HTML), and
   * used to seed the document only when `value` is empty. Optional: most
   * consumers only need `value`/`onChange`. */
  json?: SerializedEditorState;
  onJsonChange?: (json: SerializedEditorState) => void;
  /** Restricts the toolbar to inline formatting and undo/redo, hiding the
   * block-level "turn into" and alignment menus - for fields that should
   * only ever hold a single inline run (e.g. a title). @default false */
  inline?: boolean;
}

/** Public entry point - stays a thin props-in/JSX-out wrapper around
 * `./useRichTextEditor.ts` (the editor engine) and `./toolbar.tsx` (the
 * toolbar UI); see the sibling files in this folder to add, remove, or edit
 * a feature. */
export default function RichTextField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  placeholder,
  disabled = false,
  required = false,
  description,
  json,
  onJsonChange,
  inline = false,
  source,
  class: className,
  style,
}: RichTextFieldProps) {
  const { contentRef, editorRef, state, empty } = useRichTextEditor({ value, onChange, json, onJsonChange });

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="richtext" aria-invalid={error || undefined}>
        <RichTextToolbar
          editorRef={editorRef}
          state={state}
          disabled={disabled}
          contentRef={contentRef}
          inline={inline}
          source={source}
        />
        <div
          ref={contentRef}
          class={`richtext-content${empty ? " is-empty" : ""}`}
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          data-placeholder={placeholder}
        />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
