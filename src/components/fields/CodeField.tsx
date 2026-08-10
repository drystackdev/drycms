import { useEffect, useId, useMemo, useState } from "preact/hooks";
// Never `prismjs` directly - see `src/lib/prism.ts`.
import Prism from "../../lib/prism.js";
import type { FieldProps } from "./field-common.js";

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
 * (it's meant for freely-editable static samples) and
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
  // Keep the overlay and the highlighted layer on the same value immediately
  // after an input event. The parent-controlled `value` can otherwise commit
  // one render later, which is especially visible when Enter adds a newline.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const highlighted = useMemo(
    () => Prism.highlight(draft, Prism.languages.jsx!, "jsx"),
    [draft],
  );
  const hasTrailingNewline = draft?.endsWith("\n");

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="editor" aria-invalid={error || undefined}>
        <pre
          class="language-jsx"
          data-has-trailing-newline={hasTrailingNewline ? "true" : undefined}
        >
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
        <textarea
          id={fieldId}
          name={name}
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          spellcheck={false}
          aria-invalid={error || undefined}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              const textarea = event.target as HTMLTextAreaElement;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const newValue = draft.slice(0, start) + "\t" + draft.slice(end);
              setDraft(newValue);
              onChange(newValue);
              setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + 1;
              });
            }
          }}
          onInput={(event) => {
            const next = (event.target as HTMLTextAreaElement).value;
            setDraft(next);
            onChange(next);
          }}
        />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
