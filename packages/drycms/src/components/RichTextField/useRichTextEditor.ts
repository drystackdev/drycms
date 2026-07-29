import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  insertHardBreak,
  isClearable,
  isMarkActive,
  hasInlineContent,
  getBlockType,
  getSelectedImage,
  getTextAlignState,
  getTextColorState,
} from "./commands.js";
import { exportCleanHtml, importCleanHtml } from "./html.js";
import { ImageNodeView } from "./image-view.js";
import { createEmptyDoc, schema } from "./schema.js";
import { NO_FORMAT, type ToolbarState } from "./types.js";

/** ProseMirror's own `EditorState.toJSON()` shape (`{ doc, selection,
 * storedMarks? }`) - this field's equivalent of Lexical's
 * `SerializedEditorState`. */
export type RichTextJSON = ReturnType<EditorState["toJSON"]>;

export interface UseRichTextEditorOptions {
  /** HTML string - always the primary seed when non-empty (see `json`
   * below for the fallback). Reported on every change via `onChange`. */
  value: string;
  onChange: (value: string) => void;
  /** ProseMirror's serialized doc, as an object rather than a JSON string -
   * optional secondary seed/report pair alongside `value`/`onChange`. Only
   * used to seed the document when `value` is empty. */
  json?: RichTextJSON;
  onJsonChange?: (json: RichTextJSON) => void;
  label: string;
  placeholder?: string;
  disabled: boolean;
}

export interface UseRichTextEditorResult {
  contentRef: RefObject<HTMLDivElement>;
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  empty: boolean;
}

function readToolbarState(state: EditorState): ToolbarState {
  const align = getTextAlignState(state);
  const color = getTextColorState(state);
  return {
    format: {
      bold: isMarkActive(schema.marks.bold!)(state),
      italic: isMarkActive(schema.marks.italic!)(state),
      underline: isMarkActive(schema.marks.underline!)(state),
    },
    align: align.selected,
    color: color.value,
    blockType: getBlockType(state),
    clearable: isClearable(state),
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
    inlineEditable: hasInlineContent(state),
    selectedImage: getSelectedImage(state),
  };
}

/** Unlike the old Lexical version's emptiness check
 * (`$getRoot().getTextContent().length === 0`), a doc holding an image and
 * no text does NOT count as "empty" here - `textContent` alone misses the
 * image (an atom node contributes nothing to it), so a doc is only empty
 * once it has neither text nor an image. */
function isDocEmpty(state: EditorState): boolean {
  if (state.doc.textContent.length > 0) return false;
  let hasImage = false;
  state.doc.descendants((node) => {
    if (node.type === schema.nodes.image) hasImage = true;
  });
  return !hasImage;
}

function buildAttributes(state: EditorState, disabled: boolean, placeholder: string | undefined, label: string) {
  return {
    class: `richtext-content${isDocEmpty(state) ? " is-empty" : ""}`,
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": label,
    ...(placeholder ? { "data-placeholder": placeholder } : {}),
    ...(disabled ? { "aria-disabled": "true" } : {}),
  };
}

/**
 * Owns the ProseMirror editor's whole lifecycle: creation, seeding `value`,
 * wiring the history/keymap plugins, and tracking whatever live state the
 * toolbar (`./toolbar-buttons.ts`) needs to read. A future feature that
 * needs a new plugin or a new piece of toolbar-visible state belongs here -
 * `RichTextField.tsx` itself should stay a thin props-in/JSX-out wrapper
 * around this hook.
 */
export function useRichTextEditor({
  value,
  onChange,
  json,
  onJsonChange,
  label,
  placeholder,
  disabled,
}: UseRichTextEditorOptions): UseRichTextEditorResult {
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onJsonChangeRef = useRef(onJsonChange);
  onJsonChangeRef.current = onJsonChange;

  const [state, setState] = useState<ToolbarState>({
    format: NO_FORMAT,
    align: "left",
    color: "",
    blockType: "paragraph",
    clearable: false,
    canUndo: false,
    canRedo: false,
    inlineEditable: true,
    selectedImage: null,
  });
  const [empty, setEmpty] = useState(true);

  // Editor state is owned by ProseMirror after mount; `value` only seeds the
  // initial document, matching how every ProseMirror framework binding
  // treats "controlled" rich text (re-parsing on each keystroke would fight
  // the caret/selection).
  useEffect(() => {
    const mountEl = contentRef.current;
    if (!mountEl) return;

    let doc = createEmptyDoc();
    if (value) {
      try {
        doc = importCleanHtml(value);
      } catch (err) {
        console.error("[drycms] Failed to parse RichTextField value", err);
      }
    } else if (json?.doc) {
      try {
        doc = schema.nodeFromJSON(json.doc);
      } catch (err) {
        console.error("[drycms] Failed to parse RichTextField json", err);
      }
    }

    const editorState = EditorState.create({
      schema,
      doc,
      plugins: [
        history(),
        keymap({
          "Shift-Enter": insertHardBreak(),
          "Mod-z": undo,
          "Mod-y": redo,
          "Shift-Mod-z": redo,
        }),
        keymap(baseKeymap),
      ],
    });

    const view = new EditorView(mountEl, {
      state: editorState,
      editable: () => !disabled,
      attributes: (state) => buildAttributes(state, disabled, placeholder, label),
      nodeViews: {
        image: (node, editorView, getPos) => new ImageNodeView(node, editorView, getPos),
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
        setState(readToolbarState(newState));
        setEmpty(isDocEmpty(newState));
        if (tr.docChanged) {
          onChangeRef.current(exportCleanHtml(newState.doc));
          onJsonChangeRef.current?.(newState.toJSON() as RichTextJSON);
        }
      },
    });
    viewRef.current = view;
    setState(readToolbarState(editorState));
    setEmpty(isDocEmpty(editorState));

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once, see comment above
  }, []);

  // `disabled`/`placeholder`/`label` can change after mount without a full
  // remount - ProseMirror owns this dom node now, so pushing the update
  // through `setProps` (rather than relying on Preact's own re-render) is
  // what actually applies it.
  useEffect(() => {
    viewRef.current?.setProps({
      editable: () => !disabled,
      attributes: (state) => buildAttributes(state, disabled, placeholder, label),
    });
  }, [disabled, placeholder, label]);

  return { contentRef, viewRef, state, empty };
}
