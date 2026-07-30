import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { baseKeymap, chainCommands } from "prosemirror-commands";
import { history, redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { goToNextCell, tableEditing } from "prosemirror-tables";
import { path as basePath } from "virtual:drycms/config";
import type { DryComponentRecord } from "./component-registry-types.js";
import { richtextContentShadowStyles } from "./content-shadow-styles.js";
import {
  insertHardBreak,
  isClearable,
  isMarkActive,
  hasInlineContent,
  hasTextSelection,
  getBlockType,
  getLinkState,
  getSelectedImage,
  getTextAlignState,
  getTextColorState,
} from "./commands.js";
import { DryComponentNodeView } from "./dry-component-view.js";
import { defineDryComponent, loadBuiltComponent } from "./dry-component-runtime.js";
import { exportCleanHtml, importCleanHtml } from "./html.js";
import { exitGridDownward, getSelectedGrid, splitGridItem } from "./grid.js";
import { GridItemNodeView } from "./grid-item-view.js";
import { gridResizing } from "./grid-resize.js";
import { ImageNodeView } from "./image-view.js";
import { getListType } from "./lists.js";
import { isReorderActive, reorderMode } from "./reorder-mode.js";
import { createEmptyDoc, schema, setRichtextComponents } from "./schema.js";
import { exitTableDownward, exitTableForward, getSelectedTable } from "./table.js";
import { tableColumnResizing } from "./table-column-resize.js";
import { TableNodeView } from "./table-node-view.js";
import { tableRowResizing } from "./table-row-resize.js";
import { NO_FORMAT, type ToolbarState } from "./types.js";

/** Every `RichTextField` on a page shares one confirmed-component registry -
 * fetched once (not per instance) and memoized here, module-scope. Resolves
 * to `[]` on any failure (offline, integration not mounted, ...) rather than
 * rejecting - a richtext field with no custom components available is a
 * perfectly normal state, not an error the field itself should surface. */
let richtextComponentsPromise: Promise<DryComponentRecord[]> | null = null;

/** Exported for `dry-component-insert-button.tsx` to reuse - opening the
 * insert dialog shouldn't pay a second round trip for a registry this same
 * field instance already fetched on mount. */
export function loadRichtextComponents(): Promise<DryComponentRecord[]> {
  richtextComponentsPromise ??= fetch(`${basePath}/api/richtext-components`)
    .then((res) => (res.ok ? res.json() : { records: [] }))
    .then((data) => (Array.isArray(data.records) ? (data.records as DryComponentRecord[]) : []))
    .catch(() => []);
  return richtextComponentsPromise;
}

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
    hasSelection: hasTextSelection(state),
    selectedImage: getSelectedImage(state),
    listType: getListType(state),
    selectedTable: getSelectedTable(state),
    selectedGrid: getSelectedGrid(state),
    link: getLinkState(state),
    reorderModeActive: isReorderActive(state),
  };
}

/** Unlike the old Lexical version's emptiness check
 * (`$getRoot().getTextContent().length === 0`), a doc holding non-text
 * content and no text does NOT count as "empty" here - `textContent` alone
 * misses any of it (an atom/block node contributes nothing to it). Rather
 * than special-casing every such node type by name (this used to check only
 * for `image`, so a table, a grid, or a `dry-*` component dropped in with no
 * text left the placeholder showing right on top of it), anything that
 * isn't a textblock (paragraph/heading/code block - the node kinds whose
 * content model is inline, and which `textContent` above already accounts
 * for) counts as real content: an image, a `dry_*` component (inline or
 * block), a table/row/cell, a grid/grid item, an `hr`, and whatever future
 * node type joins them, all for free. */
function isDocEmpty(state: EditorState): boolean {
  if (state.doc.textContent.length > 0) return false;
  let empty = true;
  state.doc.descendants((node) => {
    if (!empty) return false;
    if (!node.isTextblock) {
      empty = false;
      return false;
    }
    return true;
  });
  return empty;
}

function buildAttributes(state: EditorState, disabled: boolean, placeholder: string | undefined, label: string) {
  return {
    class: `dry-tx-content${isDocEmpty(state) ? " is-empty" : ""}${isReorderActive(state) ? " dry-tx-reorder-active" : ""}`,
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
    hasSelection: false,
    selectedImage: null,
    listType: "none",
    selectedTable: null,
    selectedGrid: null,
    link: { href: "", target: null, active: false, disabled: true },
    reorderModeActive: false,
  });
  const [empty, setEmpty] = useState(true);

  // Editor state is owned by ProseMirror after mount; `value` only seeds the
  // initial document, matching how every ProseMirror framework binding
  // treats "controlled" rich text (re-parsing on each keystroke would fight
  // the caret/selection).
  useEffect(() => {
    const mountEl = contentRef.current;
    if (!mountEl) return;
    // `EditorView` construction has to wait on the confirmed-component
    // registry (mục 5, `status/register-compoennt.md`) - the schema itself
    // (`setRichtextComponents`) and the `nodeViews` map below both need it
    // resolved first, and unlike every other plugin/prop here that's an
    // inherently async fetch (see `loadRichtextComponents`). `cancelled` +
    // `view` hoisted to the effect's own scope (not just the `const` inside
    // the old synchronous body) so the cleanup function - itself still
    // synchronous, returned before any of this resolves - can both stop a
    // late-arriving mount from happening at all, and still tear down a view
    // that DID make it up before unmount.
    let cancelled = false;
    let view: EditorView | null = null;

    void (async () => {
      const components = await loadRichtextComponents();
      if (cancelled) return;

      setRichtextComponents(components);
      const dryNodeViews: Record<string, (node: PMNode, editorView: EditorView, getPos: () => number | undefined) => DryComponentNodeView> = {};
      for (const component of components) {
        const loader = loadBuiltComponent(basePath, component.name);
        defineDryComponent(component.name, loader, component.shadow);
        const tag = `dry-${component.name}`;
        dryNodeViews[`dry_${component.name}`] = (node, editorView, getPos) =>
          new DryComponentNodeView(node, tag, component.type, component.children, editorView, getPos);
      }

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
        // First in the array so it gets first crack at every pointerdown on
        // its own handle widgets, same "this plugin needs first dibs"
        // precedent `tableColumnResizing()` documents below for itself.
        reorderMode(),
        history(),
        keymap({
          "Shift-Enter": insertHardBreak(),
          "Mod-z": undo,
          "Mod-y": redo,
          "Shift-Mod-z": redo,
          // `splitListItem` first (innermost - a list nested inside a grid
          // cell should split its own item, not break out to a new grid
          // cell), falling through to `splitGridItem` when the selection
          // isn't inside a list, falling through again to `baseKeymap`'s
          // own default Enter (below) everywhere else - see `grid.ts`'s own
          // doc comment on `splitGridItem` for why plain Enter isn't legal
          // inside a grid cell to begin with.
          Enter: chainCommands(splitListItem(schema.nodes.list_item!), splitGridItem()),
          Tab: chainCommands(sinkListItem(schema.nodes.list_item!), goToNextCell(1), exitTableForward()),
          "Shift-Tab": chainCommands(liftListItem(schema.nodes.list_item!), goToNextCell(-1)),
          ArrowDown: chainCommands(exitTableDownward(), exitGridDownward()),
        }),
        keymap(baseKeymap),
        // Both resize plugins before `tableEditing()` - ProseMirror tries each
        // plugin's `handleDOMEvents.mousedown` in array order, and `someProp`
        // only short-circuits on a *truthy* return; `tableEditing()`'s own
        // handler (prosemirror-tables' `handleMouseDown$1`) runs its full body
        // - including unconditionally attaching its own `mousemove` cell-
        // selection tracker whenever the mousedown lands inside any table cell
        // - before returning falsy to let the next plugin have a turn. Listed
        // after it, our own `mousedown`/`pointerdown` handlers would already be
        // too late: dragging a column boundary crosses into the neighboring
        // cell, which that tracker reads as "selecting into a new cell" and
        // dispatches a real `CellSelection` transaction for on every such
        // crossing - each one redraws the table from its still-unchanged
        // `colWidths`/`heightPx` attrs, undoing `table-column-resize.ts`'s
        // (and, latently, `table-row-resize.ts`'s) live drag preview almost as
        // soon as it's applied. Listed first, our own handlers get to return
        // `true` and claim the event outright, so `tableEditing()`'s handler -
        // and the competing tracker it would've installed - never runs at all.
        tableColumnResizing(),
        tableRowResizing(),
        tableEditing(),
        gridResizing(),
      ],
    });

    view = new EditorView(editorHost, {
      state: editorState,
      editable: (state) => !disabled && !isReorderActive(state),
      attributes: (state) => buildAttributes(state, disabled, placeholder, label),
      nodeViews: {
        image: (node, editorView, getPos) => new ImageNodeView(node, editorView, getPos),
        table: (node) => new TableNodeView(node),
        grid_item: (node, editorView, getPos) => new GridItemNodeView(node, editorView, getPos),
        ...dryNodeViews,
      },
      dispatchTransaction(tr) {
        // Non-null: only ever invoked after the `view =` assignment right
        // below completes (ProseMirror never calls it during construction
        // itself) - `let view: EditorView | null` (not `const`, see this
        // effect's own doc comment above) means TS can't narrow that across
        // this closure the way it could have for the old synchronous body's
        // `const view`.
        const newState = view!.state.apply(tr);
        view!.updateState(newState);
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
    })();

    return () => {
      cancelled = true;
      // Only set if the async work above had already reached
      // `new EditorView(...)` before this ran - a mount cancelled while
      // still awaiting `loadRichtextComponents()` never got that far, and
      // `cancelled` (checked right after that `await`) stops it from
      // starting to build one at all.
      if (view) {
        view.destroy();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once, see comment above
  }, []);

  // `disabled`/`placeholder`/`label` can change after mount without a full
  // remount - ProseMirror owns this dom node now, so pushing the update
  // through `setProps` (rather than relying on Preact's own re-render) is
  // what actually applies it.
  useEffect(() => {
    viewRef.current?.setProps({
      editable: (state) => !disabled && !isReorderActive(state),
      attributes: (state) => buildAttributes(state, disabled, placeholder, label),
    });
  }, [disabled, placeholder, label]);

  return { contentRef, viewRef, state, empty };
}
