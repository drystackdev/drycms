import { useMemo } from "preact/hooks";
import Prism from "prismjs";
// jsx extends the markup grammar, so plain HTML/XML snippets still highlight
// fine under it too - see `Demo.tsx`'s own note, this is the same import.
import "prismjs/components/prism-jsx";
import { useOverlayScrollbars } from "./overlayscrollbars.js";

interface Props {
  code: string;
  /** Prism grammar to highlight with. @default "jsx" */
  lang?: string;
}

/** The Prism-highlighted `<pre><code>` block `Demo.tsx` uses for every
 * showcase sample - pulled out standalone so other surfaces (the icon
 * preview dialog's copy-paste snippet) can reuse the exact same highlighted
 * look without Demo's header/description/live-preview-slot wrapper around it. */
export default function CodeBlock({ code, lang = "jsx" }: Props) {
  const grammar = Prism.languages[lang] ? lang : "jsx";
  const highlighted = useMemo(
    () => Prism.highlight(code.trim(), Prism.languages[grammar]!, grammar),
    [code, grammar],
  );
  const { ref: pre } = useOverlayScrollbars<HTMLPreElement>();

  return (
    <pre class={`language-${grammar}`} ref={pre}>
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
}
