import { useId, useMemo, useRef } from "preact/hooks";
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
 * `.editor.code-field` (components.css) gives the two stacked layers a
 * fixed height and their own independent scroll, so the visible `pre` has
 * to be kept in sync by hand with whatever the (real, focusable) `textarea`
 * scrolls to - `onScroll` below mirrors its `scrollTop` onto `pre` on every
 * scroll (mouse wheel, or the browser auto-scrolling the textarea to keep
 * the caret in view as you type/navigate past the visible area).
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
  const preRef = useRef<HTMLPreElement>(null);
  const highlighted = useMemo(
    () => Prism.highlight(value, JSX_GRAMMAR, "jsx"),
    [value],
  );

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="editor code-field" aria-invalid={error || undefined}>
        <pre class="language-jsx" ref={preRef}>
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
          onScroll={(event) => {
            const pre = preRef.current;
            if (pre) pre.scrollTop = (event.target as HTMLTextAreaElement).scrollTop;
          }}
        />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
