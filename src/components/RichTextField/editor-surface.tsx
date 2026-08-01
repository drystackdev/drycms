import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import { useRichTextEditor } from "./useRichTextEditor.js";
import type { ToolbarState } from "./types.js";
import type { RichTextFieldConfig } from "../../content-types/field-registry.js";

interface EditorSurfaceProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled: boolean;
  inline: boolean;
  placeholder?: string;
  onReady: (result: EditorSurfaceResult) => void;
  features?: RichTextFieldConfig;
}

interface EditorSurfaceResult {
  contentRef: RefObject<HTMLDivElement>;
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  empty: boolean;
  loading: boolean;
}

export default function EditorSurface({ value, onChange, label, disabled, inline, placeholder, onReady }: EditorSurfaceProps) {
  const result = useRichTextEditor({ value, onChange, label, disabled, inline });
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    onReadyRef.current(result);
  }, [result.state, result.empty, result.loading]);

  return (
    <div class="richtext-content-mount">
      <div ref={result.contentRef} class="richtext-content-host" />
      {result.loading ? (
        <div class="richtext-placeholder" aria-hidden="true">Loading…</div>
      ) : (
        result.empty && placeholder && <div class="richtext-placeholder" aria-hidden="true">{placeholder}</div>
      )}
    </div>
  );
}
