import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentType, RefObject } from "preact";
import type { FieldProps } from "../field-common.js";
import type { FileManagerSource } from "../file-manager-types.js";
import { useScrollLock } from "../list-nav.js";
import ImageMenu from "./image-menu.js";
import DryComponentMention from "./dry-component-mention.js";
import DryRichTextSlash from "./dry-richtext-slash.js";
import RichTextToolbar from "./toolbar.js";
import type { EditorView } from "prosemirror-view";
import type { ToolbarIconSize, ToolbarState } from "./types.js";
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

const INITIAL_TOOLBAR_STATE: ToolbarState = {
  format: { bold: false, italic: false, underline: false },
  align: "left",
  color: "",
  blockType: "paragraph",
  clearable: false,
  canUndo: false,
  canRedo: false,
  inlineEditable: true,
  hasSelection: false,
  selectedImage: null,
  listType: "none",
  selectedTable: null,
  selectedGrid: null,
  link: { href: "", target: null, active: false, disabled: true },
  reorderModeActive: false,
};

export interface RichTextFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  source?: FileManagerSource;
  inline?: boolean;
  iconSize?: ToolbarIconSize;
  features?: RichTextFieldConfig;
}

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
  inline = false,
  source,
  iconSize = "sm",
  features,
  class: className,
  style,
}: RichTextFieldProps) {
  const richtextRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [state, setState] = useState(INITIAL_TOOLBAR_STATE);
  const [empty, setEmpty] = useState(true);
  const [loading, setLoading] = useState(true);
  const [EditorSurface, setEditorSurface] = useState<ComponentType<EditorSurfaceProps> | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useScrollLock(fullscreen, richtextRef);

  useEffect(() => {
    let cancelled = false;
    void import("./editor-surface.js").then(({ default: surface }) => {
      if (!cancelled) setEditorSurface(() => surface);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(raf);
  }, [fullscreen]);

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div
        ref={richtextRef}
        class={`richtext${fullscreen ? " richtext-fullscreen" : ""}${inline ? " inline" : ""}`}
        aria-invalid={error || undefined}
      >
        {fullscreen && (
          <div class="richtext-fullscreen-header">
            <label>
              {label}
              {required && <span class="required-asterisk">*</span>}
            </label>
            {description && <small>{description}</small>}
          </div>
        )}
        <RichTextToolbar
          viewRef={viewRef}
          state={state}
          disabled={disabled || loading}
          contentRef={contentRef}
          inline={inline}
          features={features}
          source={source}
          iconSize={iconSize}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((current) => !current)}
        />
        {EditorSurface ? (
          <EditorSurface
            value={value}
            onChange={onChange}
            label={label}
            disabled={disabled}
            inline={inline}
            features={features}
            placeholder={placeholder}
            onReady={({ contentRef: nextContentRef, viewRef: nextViewRef, state: nextState, empty: nextEmpty, loading: nextLoading }) => {
              contentRef.current = nextContentRef.current;
              viewRef.current = nextViewRef.current;
              setState(nextState);
              setEmpty(nextEmpty);
              setLoading(nextLoading);
            }}
          />
        ) : (
          <div class="richtext-content-mount">
            <div class="richtext-placeholder" aria-hidden="true">Loading...</div>
          </div>
        )}
        <ImageMenu viewRef={viewRef} state={state} disabled={disabled || loading} source={source} iconSize={iconSize} />
        <DryComponentMention viewRef={viewRef} ready={!loading} disabled={disabled} />
        <DryRichTextSlash viewRef={viewRef} ready={!loading} disabled={disabled} state={state} source={source} />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
