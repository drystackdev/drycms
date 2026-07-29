import type { FieldProps } from "./field-common.js";
import type { FileManagerSource } from "./file-manager-types.js";
import ImageMenu from "./RichTextField/image-menu.js";
import RichTextToolbar from "./RichTextField/toolbar.js";
import type { ToolbarIconSize } from "./RichTextField/types.js";
import {
  useRichTextEditor,
  type RichTextJSON,
} from "./RichTextField/useRichTextEditor.js";

export interface RichTextFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  /** Where the toolbar's "Insert image" button reads its files from - the
   * button (and the picker dialog behind it) only exists when this is set,
   * same optionality as `ImageField`'s own `source` prop. */
  source?: FileManagerSource;
  /** ProseMirror's serialized doc, as an object rather than a JSON string -
   * reported on every change alongside `value` (always HTML), and used to
   * seed the document only when `value` is empty. Optional: most consumers
   * only need `value`/`onChange`. */
  json?: RichTextJSON;
  onJsonChange?: (json: RichTextJSON) => void;
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
  json,
  onJsonChange,
  inline = false,
  source,
  iconSize,
  class: className,
  style,
}: RichTextFieldProps) {
  const { contentRef, viewRef, state } = useRichTextEditor({
    value,
    onChange,
    json,
    onJsonChange,
    label,
    placeholder,
    disabled,
  });

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="richtext" aria-invalid={error || undefined}>
        <RichTextToolbar
          viewRef={viewRef}
          state={state}
          disabled={disabled}
          contentRef={contentRef}
          inline={inline}
          source={source}
          iconSize={iconSize}
        />
        {/* ProseMirror's `EditorView` appends its own contenteditable dom
         * into this mount node and owns its attributes/content from then on -
         * see `useRichTextEditor.ts`'s `buildAttributes`. */}
        <div ref={contentRef} />
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
