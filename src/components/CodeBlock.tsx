import { useMemo, useState } from "preact/hooks";
import Prism from "prismjs";
// The only grammar CodeBlock highlights with - jsx extends the markup
// grammar, so plain HTML/XML snippets (e.g. the icon dialogs' `<i>`
// snippets) still highlight fine under it too.
import "prismjs/components/prism-jsx";
import { toast } from "./Toast.js";
import { CopyIcon } from "./icons/index.js";
import type { CSSProperties } from "preact";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";

const JSX_GRAMMAR = Prism.languages.jsx!;

interface Props {
  code: string;
  /** Wrap long lines instead of scrolling horizontally, capping the block's
   * own height (`maxHeight`) and scrolling vertically past that - opt-in,
   * since Demo.tsx's wide JSX samples read better with the default
   * horizontal-scroll behavior. @default false */
  wrap?: boolean;
  /** Only meaningful with `wrap`. @default "7rem" */
  maxHeight?: string;
  /** Adds a corner button that copies the raw (un-highlighted) `code` to the
   * clipboard and confirms via toast. @default false */
  copyable?: boolean;
  /** Pretty-prints `code` (via `formatHtml`) before highlighting/copying -
   * for single-line HTML exports (e.g. Lexical's) rather than source that's
   * already formatted. @default false */
  formatHtml?: boolean;
  /** Lets the sample be edited in place: a transparent `<textarea>` stacked
   * over the highlighted `<pre>` (invisible text, visible caret - the `pre`
   * underneath re-highlights on every keystroke and stays the only thing
   * actually drawn). Ignores `wrap`/`maxHeight`; grows with its content
   * instead of scrolling. @default false */
  editable?: boolean;
  /** Fires with the edited code on every keystroke. Only meaningful with
   * `editable`. */
  onChange?: (code: string) => void;
  style?: CSSProperties;
  class?: string;
}

/** Breaks single-line HTML (e.g. Lexical's export) into one tag per line,
 * indented by nesting depth - just enough to review the markup, not a full
 * parser. */
const VOID_HTML_TAG =
  /^<(?:br|hr|img|input|meta|link|col|area|base|embed|source|track|wbr)(?:[\s/][^>]*)?>$/i;
export function formatHtml(html: string): string {
  if (!html) return html;
  const lines = html.replace(/></g, ">\n<").split("\n");
  const INDENT = "  ";
  let depth = 0;
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isClosingTag = /^<\/[a-zA-Z][^>]*>$/.test(line);
    const isVoidTag = VOID_HTML_TAG.test(line);
    const isSelfClosingTag = line.endsWith("/>");
    const isOpeningTagOnly =
      !isClosingTag &&
      !isVoidTag &&
      !isSelfClosingTag &&
      /^<[a-zA-Z][^>]*>$/.test(line) &&
      !line.includes("</");
    if (isClosingTag) depth = Math.max(depth - 1, 0);
    out.push(INDENT.repeat(depth) + line);
    if (isOpeningTagOnly) depth++;
  }
  return out.join("\n");
}

/** The Prism-highlighted `<pre><code>` block `Demo.tsx` uses for every
 * showcase sample - pulled out standalone so other surfaces (the icon
 * preview dialog's copy-paste snippet) can reuse the exact same highlighted
 * look without Demo's header/description/live-preview-slot wrapper around it. */
export default function CodeBlock({
  code: _code,
  wrap = false,
  maxHeight = "100dvh",
  copyable = false,
  formatHtml: shouldFormatHtml = false,
  editable = false,
  onChange,
  class: className,
  style,
}: Props) {
  // Only `editable` needs its own mutable copy (typing in the overlaid
  // textarea updates it independently of the `code` prop) - every other
  // consumer passes a `code` that can change on every render (e.g. a live
  // preview mirroring a field's value), and `useState(_code)` would freeze
  // that at whatever `_code` was on first mount.
  const [localCode, setLocalCode] = useState(() => _code.trim());
  const { ref: divRef } = useOverlayScrollbars<HTMLDivElement>();
  const code = editable ? localCode : _code;
  // Trimming is only for the initial/static display (drops incidental
  // leading/trailing blank lines from a template-literal `code` prop) - once
  // `editable`, it must stop re-applying on every keystroke, or a trailing
  // newline the user just typed gets eaten the moment it re-renders.
  const displayCode = useMemo(() => {
    const formatted = shouldFormatHtml ? formatHtml(code) : code;
    return editable ? formatted : formatted.trim();
  }, [code, shouldFormatHtml, editable]);
  const highlighted = useMemo(
    () => Prism.highlight(displayCode, JSX_GRAMMAR, "jsx"),
    [displayCode],
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(displayCode).then(
      () => toast.add({ type: "success", title: "Copied to clipboard." }),
      () => toast.add({ type: "error", title: "Could not copy to clipboard." }),
    );
  };

  const highlightedPre = (
    <pre
      class={wrap ? "language-jsx wrap" : "language-jsx"}
      style={wrap ? { maxHeight } : undefined}
    >
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );

  // Transparent `<textarea>` stacked exactly over the highlighted `<pre>`
  // (see `.editor` in components.css) - only the caret shows, the visible
  // text always comes from the re-highlighted `pre` underneath. Not wrapped
  // for the (default) non-editable case, so existing consumers keep getting
  // a bare `<pre>` (e.g. Demo.tsx's `.demo-code > pre` styling).
  const block = editable ? (
    <div class="editor">
      {highlightedPre}
      <textarea
        value={displayCode}
        spellcheck={false}
        onInput={(event) => {
          const next = (event.target as HTMLTextAreaElement).value;
          setLocalCode(next);
          onChange?.(next);
        }}
      />
    </div>
  ) : (
    highlightedPre
  );

  if (!copyable) return block;

  return (
    <div class={`code-block ${className}`} ref={divRef} style={style}>
      <div >
        {block}
      </div>
      <button
        type="button"
        class="code-block-copy ghost icon sm"
        aria-label="Copy code"
        onClick={handleCopy}
      >
        <CopyIcon />
      </button>
    </div>
  );
}
