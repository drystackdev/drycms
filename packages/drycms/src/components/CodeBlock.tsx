import { useMemo } from "preact/hooks";
import Prism from "prismjs";
// jsx extends the markup grammar, so plain HTML/XML snippets still highlight
// fine under it too - see `Demo.tsx`'s own note, this is the same import.
import "prismjs/components/prism-jsx";
import { toast } from "./Toast.js";
import { CopyIcon } from "./icons.js";
import { useOverlayScrollbars } from "./overlayscrollbars.js";
import type { CSSProperties } from "preact";

interface Props {
  code: string;
  /** Prism grammar to highlight with. @default "jsx" */
  lang?: string;
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
  style?: CSSProperties;
  class?: string;
}

/** The Prism-highlighted `<pre><code>` block `Demo.tsx` uses for every
 * showcase sample - pulled out standalone so other surfaces (the icon
 * preview dialog's copy-paste snippet) can reuse the exact same highlighted
 * look without Demo's header/description/live-preview-slot wrapper around it. */
export default function CodeBlock({
  code,
  lang = "jsx",
  wrap = false,
  maxHeight = "7rem",
  copyable = false,
  class: className,
  style,
}: Props) {
  const grammar = Prism.languages[lang] ? lang : "jsx";
  const highlighted = useMemo(
    () => Prism.highlight(code.trim(), Prism.languages[grammar]!, grammar),
    [code, grammar],
  );
  const { ref: pre } = useOverlayScrollbars<HTMLPreElement>();

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(
      () => toast.add({ type: "success", title: "Copied to clipboard." }),
      () => toast.add({ type: "error", title: "Could not copy to clipboard." }),
    );
  };

  const block = (
    <pre
      class={wrap ? `language-${grammar} wrap` : `language-${grammar}`}
      style={wrap ? { maxHeight } : undefined}
      ref={pre}
    >
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );

  if (!copyable) return block;

  return (
    <div class={`code-block ${className}`} style={style}>
      {block}
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
