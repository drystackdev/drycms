import { useEffect, useRef, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import type { FileManagerSource } from "./file-manager-types.js";
import { useScrollLock } from "./list-nav.js";
import ImageMenu from "./RichTextField/image-menu.js";
import RichTextToolbar from "./RichTextField/toolbar.js";
import type { ToolbarIconSize } from "./RichTextField/types.js";
import { useRichTextEditor } from "./RichTextField/useRichTextEditor.js";

export interface RichTextFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  /** Where the toolbar's "Insert image" button reads its files from - the
   * button (and the picker dialog behind it) only exists when this is set,
   * same optionality as `ImageField`'s own `source` prop. */
  source?: FileManagerSource;
  /** Restricts the toolbar to inline formatting and undo/redo, hiding the
   * block-level "turn into" and alignment menus - for fields that should
   * only ever hold a single inline run (e.g. a title). @default false */
  inline?: boolean;
  /** Applied to every toolbar button's icon sizing class, same scale as
   * every other icon-only button in drycms. @default "md" */
  iconSize?: ToolbarIconSize;
}

/** Public entry point - stays a thin props-in/JSX-out wrapper around
 * `./useRichTextEditor.ts` (the editor engine) and `./toolbar.tsx` (the
 * toolbar UI); see the sibling files in this folder to add, remove, or edit
 * a feature. */
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
  class: className,
  style,
}: RichTextFieldProps) {
  const { contentRef, viewRef, state, empty, loading } = useRichTextEditor({
    value,
    onChange,
    label,
    disabled,
  });

  const richtextRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useScrollLock(fullscreen, richtextRef);

  // Escape exits fullscreen - same "window-level keydown while open" pattern
  // as SidebarToggle.tsx's own outside-click/Escape handling.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Toggling fullscreen moves `ImageMenu`'s anchor (a node inside
  // `.richtext-content`) without changing its own size, so `useTrackRect`'s
  // `ResizeObserver` (in list-nav.ts) never fires for it - it only
  // re-measures on the anchor's own resize or a window scroll/resize event.
  // A synthetic resize next frame (once the class change has actually
  // reflowed) nudges any open floating panel back into place.
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
        class={`richtext${fullscreen ? " richtext-fullscreen" : ""}`}
        aria-invalid={error || undefined}
      >
        {/* Fullscreen takes `.richtext` out of flow to fill the viewport
         * (see `.richtext-fullscreen` in forms.css), which leaves the real
         * label/description above - siblings of `.richtext`, not inside it -
         * hidden behind the overlay. A second copy, shown only here, is the
         * only way fullscreen mode still identifies which field it is. */}
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
          disabled={disabled}
          contentRef={contentRef}
          inline={inline}
          source={source}
          iconSize={iconSize}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((current) => !current)}
        />
        {/* ProseMirror's `EditorView` appends its own contenteditable dom as
         * a CHILD of `.richtext-content-host` below (rather than using it
         * directly) and owns its attributes/content from then on - see
         * `useRichTextEditor.ts`'s `buildAttributes`. `.richtext-content-mount`
         * itself stays a plain wrapper - still the actual flex item
         * fullscreen mode sizes (see `.richtext-content-mount` in forms.css),
         * and its `position: relative` there is what anchors
         * `.richtext-placeholder` below. That placeholder is a real light-DOM
         * element (unlike the old shadow-DOM-only `::before` it replaced) so
         * it's easy to select/assert on from outside the field; it reads
         * "Loading…" for as long as the hook's own async component-registry
         * fetch (`loading`) hasn't resolved yet, since nothing else on
         * screen otherwise shows the field isn't ready, then falls back to
         * the real `placeholder` text once the doc is confirmed empty. */}
        <div class="richtext-content-mount">
          <div ref={contentRef} class="richtext-content-host" />
          {loading ? (
            <div class="richtext-placeholder" aria-hidden="true">
              Loading…
            </div>
          ) : (
            empty &&
            placeholder && (
              <div class="richtext-placeholder" aria-hidden="true">
                {placeholder}
              </div>
            )
          )}
        </div>
        <ImageMenu
          viewRef={viewRef}
          state={state}
          disabled={disabled}
          source={source}
          iconSize={iconSize}
        />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
