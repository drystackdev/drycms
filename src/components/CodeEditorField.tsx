import { useEffect, useId, useRef } from "preact/hooks";
import { createEditor, type PrismEditor } from "prism-code-editor";
import {
  autoComplete,
  fuzzyFilter,
  registerCompletions,
  completeFromList,
  type Completion,
  type AttributeConfig,
  type TagConfig,
} from "prism-code-editor/autocomplete";
import {
  completeKeywords,
  globalReactAttributes,
  jsCompletion,
  jsContext,
  jsDocCompletion,
  jsxTagCompletion,
  reactTags,
} from "prism-code-editor/autocomplete/javascript";
import { cursorPosition } from "prism-code-editor/cursor";
import "prism-code-editor/prism/languages/jsx";
import layoutStyles from "prism-code-editor/layout.css?inline";
import autocompleteStyles from "prism-code-editor/autocomplete.css?inline";
import autocompleteIconStyles from "prism-code-editor/autocomplete-icons.css?inline";
import type { FieldProps } from "./field-common.js";

const PREACT_IDENTIFIERS = [
  "Component",
  "Fragment",
  "h",
  "createElement",
  "createContext",
  "createRef",
  "cloneElement",
  "forwardRef",
  "hydrate",
  "isValidElement",
  "memo",
  "render",
  "toChildArray",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useEffect",
  "useErrorBoundary",
  "useImperativeHandle",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
  "useRef",
  "useState",
  "useId",
  "useSignal",
  "useComputed",
  "useSignalEffect",
];

const PREACT_TAGS: TagConfig = {
  ...reactTags,
  Fragment: {},
};

const PREACT_ATTRIBUTES: AttributeConfig = {
  ...globalReactAttributes,
  class: null,
  className: null,
  dangerouslySetInnerHTML: null,
  htmlFor: null,
  key: null,
  ref: null,
};

const PREACT_COMPLETIONS: Completion[] = PREACT_IDENTIFIERS.map((label) => ({
  label,
  icon: label.startsWith("use") ? "function" : "variable",
  detail: "Preact",
}));

// Completion sources are language-global in prism-code-editor. Registering
// them once keeps every CodeEditorField instance consistent and avoids doing
// completion setup during render or while server-rendering the field.
registerCompletions(["jsx", "tsx", "javascript", "typescript", "js", "ts"], {
  context: jsContext,
  sources: [
    jsCompletion({}, PREACT_IDENTIFIERS),
    completeKeywords,
    jsDocCompletion,
    jsxTagCompletion(PREACT_TAGS, PREACT_ATTRIBUTES),
    completeFromList(PREACT_COMPLETIONS),
  ],
});

const SHADOW_STYLES = `
${layoutStyles}
${autocompleteStyles}
${autocompleteIconStyles}

:host {
  display: block;
  min-height: 13rem;
}

.code-editor-shadow-mount {
  min-height: 13rem;
  height: 100%;
}

.prism-code-editor {
  min-height: 13rem;
  height: 100%;
  font: inherit;
}

.pce-wrapper {
  margin-block: 0.75rem;
}

.pce-textarea {
  font: inherit;
}

.pce-ac-wrapper {
  z-index: 3;
  font: inherit;
}

.pce-ac-row {
  height: 1.75rem;
}

/* Prism's token colours normally come from the app's global .dry scope.
 * Keep the same palette inside this editor's shadow tree. The --dry-code-*
 * variables are inherited from the light-DOM host, so light/dark themes still
 * follow the page without exposing any editor selectors outside the root. */
:where(.token.comment, .token.prolog, .token.doctype, .token.cdata) {
  color: var(--dry-code-comment);
  font-style: italic;
}

:where(.token.punctuation) {
  color: var(--dry-code-punctuation);
}

:where(.token.tag, .token.deleted) {
  color: var(--dry-code-tag);
}

:where(.token.attr-name, .token.property, .token.class-name, .token.function) {
  color: var(--dry-code-attr-name);
}

:where(.token.tag .token.class-name) {
  color: var(--dry-code-tag);
}

:where(.token.attr-value, .token.string, .token.char, .token.inserted, .token.number) {
  color: var(--dry-code-string);
}

:where(.token.keyword, .token.selector, .token.important, .token.atrule, .token.boolean) {
  color: var(--dry-code-keyword);
  font-style: normal;
}

:where(.token.operator, .token.entity, .token.url) {
  color: var(--dry-foreground);
}

:where(.token.namespace) {
  opacity: 0.7;
}
`;

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
 * A controlled code field backed by Prism Code Editor. The editor DOM and
 * Prism/autocomplete styles live inside an open shadow root so host-page CSS
 * cannot leak into the editor and editor CSS cannot leak back out.
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

    const shadowRoot = mount.shadowRoot ?? mount.attachShadow({ mode: "open" });
    shadowRoot.replaceChildren();
    const styleElement = document.createElement("style");
    styleElement.textContent = SHADOW_STYLES;
    const editorMount = document.createElement("div");
    editorMount.className = "code-editor-shadow-mount";
    shadowRoot.append(styleElement, editorMount);

    const editor = createEditor(editorMount, {
      language,
      value,
      lineNumbers,
      wordWrap,
      tabSize,
      class: "dry-code-editor",
      onUpdate: (nextValue) => onChangeRef.current(nextValue),
    });
    editor.addExtensions(
      cursorPosition(),
      autoComplete({
        filter: fuzzyFilter,
        closeOnBlur: true,
        explicitOnly: false,
        preferAbove: false,
      }),
    );
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
    textarea.setAttribute("aria-label", label);
    textarea.setAttribute("aria-invalid", error ? "true" : "false");
  }, [fieldId, name, placeholder, disabled, required, error, label]);

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div
        ref={mountRef}
        class="code-editor-field"
        aria-invalid={error || undefined}
        aria-disabled={disabled || undefined}
      />
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}

/** Compatibility alias for the original spelling used in the task brief. */
export { CodeEditorField as CodeEditerField };
