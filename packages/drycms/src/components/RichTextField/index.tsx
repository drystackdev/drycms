import type { FieldProps } from "../field-common.js";
import RichTextToolbar from "./toolbar.js";
import { useRichTextEditor } from "./useRichTextEditor.js";

export interface RichTextFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  /** Report/seed `value` as an HTML string instead of Lexical's JSON editor
   * state. @default false */
  outHTML?: boolean;
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
  outHTML = true,
  class: className,
  style,
}: RichTextFieldProps) {
  const { contentRef, editorRef, state, empty } = useRichTextEditor({ value, onChange, outHTML });

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="richtext" aria-invalid={error || undefined}>
        <RichTextToolbar editorRef={editorRef} state={state} disabled={disabled} contentRef={contentRef} />
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
