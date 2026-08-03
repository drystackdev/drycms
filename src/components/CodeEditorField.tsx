import { useEffect, useId, useRef } from "preact/hooks";
import { createEditor, type PrismEditor } from "prism-code-editor";
import "prism-code-editor/layout.css";
import "prism-code-editor/prism/languages/jsx";
import type { FieldProps } from "./field-common.js";

export interface CodeEditorFieldProps extends FieldProps<string> {
  /** Prism language id used for syntax highlighting. @default "jsx" */
  language?: string;
  /** Whether to show a line-number gutter. @default true */
  lineNumbers?: boolean;
  /** Whether long lines wrap instead of scrolling horizontally. @default false */
  wordWrap?: boolean;
  /** Number of spaces inserted for indentation. @default 2 */
  tabSize?: number;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * A controlled code field backed by Prism Code Editor. The library's core
 * API is used instead of its shadow-root setup so the real textarea remains
 * available to the surrounding form and label.
 */
export default function CodeEditorField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  language = "jsx",
  lineNumbers = true,
  wordWrap = false,
  tabSize = 2,
  placeholder,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: CodeEditorFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `code-editor-field-${reactId}`;
  const mountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PrismEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const editor = createEditor(mount, {
      language,
      value,
      lineNumbers,
      wordWrap,
      tabSize,
      class: "dry-code-editor",
      onUpdate: (nextValue) => onChangeRef.current(nextValue),
    });
    editorRef.current = editor;

    return () => {
      editor.remove();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.value !== value) editor.setOptions({ value });
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setOptions({ language, lineNumbers, wordWrap, tabSize, readOnly: disabled });
  }, [language, lineNumbers, wordWrap, tabSize, disabled]);

  useEffect(() => {
    const textarea = editorRef.current?.textarea;
    if (!textarea) return;
    textarea.id = fieldId;
    textarea.name = name ?? "";
    textarea.placeholder = placeholder ?? "";
    textarea.disabled = disabled;
    textarea.required = required;
    textarea.spellcheck = false;
    textarea.setAttribute("aria-invalid", error ? "true" : "false");
  }, [fieldId, name, placeholder, disabled, required, error]);

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div ref={mountRef} class="code-editor-field" aria-invalid={error || undefined} />
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}

/** Compatibility alias for the original spelling used in the task brief. */
export { CodeEditorField as CodeEditerField };
