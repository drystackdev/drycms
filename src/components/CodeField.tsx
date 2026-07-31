import { useId, useMemo } from "preact/hooks";
import Prism from "prismjs";
import "prismjs/components/prism-jsx";
import type { FieldProps } from "./field-common.js";

const JSX_GRAMMAR = Prism.languages.jsx!;

export interface CodeFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * Like `TextField`, but for source code: no `multiline` prop - a code field
 * is always a multi-line editor - and JSX-highlighted as you type, via the
 * same technique `CodeBlock`'s `editable` mode uses (a transparent
 * `<textarea>` stacked over a Prism-highlighted `<pre>`, re-highlighted on
 * every keystroke; only the caret is actually drawn by the textarea itself).
 * Built directly on `.editor` rather than wrapping `CodeBlock`, since
 * `CodeBlock`'s `editable` mode keeps its own uncontrolled copy of the code
 * (it's meant for the Showcase page's freely-editable static samples) and
 * wouldn't pick up an externally-changed `value`, unlike every other
 * controlled Field in this file's family.
 *
 * Plain `.editor` (no `code-field` modifier) grows to fit its content, same
 * as `TextField`'s `multiline` textarea - the in-flow `pre` sizes the
 * container and the absolutely-positioned `textarea` overlay just matches
 * it, so there's no independent scrolling to keep in sync by hand.
 */
export default function CodeField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  placeholder,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: CodeFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `code-field-${reactId}`;
  const highlighted = useMemo(
    () => Prism.highlight(value, JSX_GRAMMAR, "jsx"),
    [value],
  );

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="editor" aria-invalid={error || undefined}>
        <pre class="language-jsx">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
        <textarea
          id={fieldId}
          name={name}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          spellcheck={false}
          aria-invalid={error || undefined}
          onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
        />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
