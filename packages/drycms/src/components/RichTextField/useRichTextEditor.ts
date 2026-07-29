import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { baseKeymap, chainCommands } from "prosemirror-commands";
import { history, redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { goToNextCell, tableEditing } from "prosemirror-tables";
import { richtextContentShadowStyles } from "./content-shadow-styles.js";
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
import { gridColumnResizing, gridColumnResizingKey } from "./grid-column-resize.js";
import { exportCleanHtml, importCleanHtml } from "./html.js";
import { ImageNodeView } from "./image-view.js";
import { getListType } from "./lists.js";
import { createEmptyDoc, schema } from "./schema.js";
import { getSelectedTable } from "./table.js";
import { tableColumnResizing } from "./table-column-resize.js";
import { tableRowResizing } from "./table-row-resize.js";
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
  /** Whether the grid feature's outline/resize handles are currently shown -
   * synced into `grid-column-resize.ts`'s own plugin state via a meta
   * transaction (see the effect below), since that's otherwise just Preact
   * state with no way to reach the plugin on its own. @default false */
  gridMode?: boolean;
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
    listType: getListType(state),
    selectedTable: getSelectedTable(state),
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
    class: `dry-tx-content${isDocEmpty(state) ? " is-empty" : ""}`,
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
  gridMode = false,
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
    listType: "none",
    selectedTable: null,
  });
  const [empty, setEmpty] = useState(true);

  // Editor state is owned by ProseMirror after mount; `value` only seeds the
  // initial document, matching how every ProseMirror framework binding
  // treats "controlled" rich text (re-parsing on each keystroke would fight
  // the caret/selection).
  useEffect(() => {
    const mountEl = contentRef.current;
    if (!mountEl) return;

    // Shadow-isolates the editable surface's own styling from the host
    // app/page's CSS in both directions - see `content-shadow-styles.ts`
    // for what that stylesheet has to independently supply as a result
    // (everything `dry.base`'s global element resets used to give it for
    // free). `mountEl` itself (`.richtext-content-mount`) stays a normal
    // light-DOM element - only what's *inside* it moves into the shadow
    // tree, so the toolbar/floating menus/dialogs elsewhere in this field
    // are untouched and keep using the app's own global styles as before.
    const shadowRoot = mountEl.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = richtextContentShadowStyles;
    shadowRoot.appendChild(styleEl);
    // A plain pass-through container for `EditorView` to append its own
    // ".dry-tx-content" contenteditable into (the "place a fresh mount
    // node" constructor form - `EditorView` doesn't take the shadow root
    // itself). Needs its own `height: 100%` in the shadow stylesheet: it's
    // `.dry-tx-content`'s real DOM parent (and so its containing block
    // for `height: 100%` to resolve against there in turn), sitting between
    // it and the shadow host `.richtext-content-mount`.
    const editorHost = document.createElement("div");
    editorHost.className = "dry-tx-content-host";
    shadowRoot.appendChild(editorHost);

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
          Enter: splitListItem(schema.nodes.list_item!),
          Tab: chainCommands(sinkListItem(schema.nodes.list_item!), goToNextCell(1)),
          "Shift-Tab": chainCommands(liftListItem(schema.nodes.list_item!), goToNextCell(-1)),
        }),
        keymap(baseKeymap),
        tableEditing(),
        tableColumnResizing(),
        tableRowResizing(),
        gridColumnResizing(),
      ],
    });

    const view = new EditorView(editorHost, {
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

  // Grid mode is plain Preact state (owned by `RichTextField.tsx`, same as
  // `fullscreen`) with no way to reach `grid-column-resize.ts`'s own plugin
  // state on its own - this meta transaction is that bridge, mirroring how
  // the plugin's own drag-preview updates bypass `onChange` (`setMeta` +
  // `view.updateState` there; a real `dispatch` here is fine since toggling
  // grid mode itself shouldn't be undoable/reported as a content change, and
  // `dispatchTransaction` only forwards to `onChange` when `tr.docChanged`).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.tr.setMeta(gridColumnResizingKey, { setGridMode: gridMode }));
  }, [gridMode]);

  return { contentRef, viewRef, state, empty };
}
