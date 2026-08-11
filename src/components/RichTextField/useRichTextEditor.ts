import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { baseKeymap, chainCommands, toggleMark } from "prosemirror-commands";
import { history, redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { goToNextCell, tableEditing } from "prosemirror-tables";
const { path: basePath } = window.__DRY_CONFIG__;
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
  removeAllMarks,
  setBlockTypeCommand,
  setTextAlign,
} from "./commands.js";
import { DryComponentNodeView } from "./dry-component-view.js";
import { defineBuiltComponents } from "./dry-component-runtime.js";
import { exportCleanHtml, importCleanHtml } from "./html.js";
import { exitGridDownward, getSelectedGrid, insertGrid, splitGridItem } from "./grid.js";
import { GridItemNodeView } from "./grid-item-view.js";
import { gridResizing } from "./grid-resize.js";
import { HtmlReorderSurface } from "./html-reorder-surface.js";
import { ImageNodeView } from "./image-view.js";
import { getListType, toggleList } from "./lists.js";
import { isReorderActive, reorderMode, reorderModeKey } from "./reorder-mode.js";
import { createEmptyDoc, schema, setRichtextComponents } from "./schema.js";
import { exitTableDownward, exitTableForward, getSelectedTable, insertTable } from "./table.js";
import { tableColumnResizing } from "./table-column-resize.js";
import { TableNodeView } from "./table-node-view.js";
import { tableRowResizing } from "./table-row-resize.js";
import { trailingParagraph, withTrailingParagraph } from "./trailing-paragraph.js";
import { NO_FORMAT, type ToolbarState } from "./types.js";
import { loadRichtextComponents } from "./component-registry.js";
import { flattenDryComponentRecords } from "./component-registry-types.js";
import { openRichTextShortcut } from "./shortcuts.js";
import { insertPastedImageFiles, pastedImagesFromClipboard, sanitizePastedHtml, type PastedImage } from "./pasted-images.js";

export interface UseRichTextEditorOptions {
  /** HTML string - the only seed/output format, reported on every change
   * via `onChange`. */
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled: boolean;
  /** Mirrors `RichTextField`'s own `inline` prop - strips the exported
   * HTML's block wrapper (`html.ts`'s `exportCleanHtml` `options.inline`)
   * instead of the usual `<p>...</p>` around a single paragraph's worth of
   * content. @default false */
  inline?: boolean;
  onPastedImages?: (images: PastedImage[]) => void;
}

export interface UseRichTextEditorResult {
  contentRef: RefObject<HTMLDivElement>;
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  empty: boolean;
  /** True until the async component-registry fetch below resolves and the
   * `EditorView` actually mounts - `RichTextField.tsx` shows a "Loading…"
   * placeholder for as long as this is true, since nothing else on screen
   * otherwise indicates the field isn't ready yet. */
  loading: boolean;
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

function nodeRefEqual(
  a: { pos: number; node: PMNode } | null,
  b: { pos: number; node: PMNode } | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.pos === b.pos && a.node === b.node;
}

/** Whether two `ToolbarState`s describe the same toolbar - `readToolbarState`
 * builds a brand-new object for EVERY transaction (each keystroke, each
 * cursor move), and handing that straight to `setState` re-rendered this
 * whole field on each one: the toolbar, the three floating menus, and - via
 * `RichTextField`'s own state lift (`editor-surface.tsx`'s `onReady` effect,
 * keyed on `state`'s identity) - its parent form too. Almost none of those
 * renders had anything to draw differently; typing a run of plain text
 * inside one paragraph changes nothing here after the first character. The
 * node-holding fields compare by identity on purpose: ProseMirror documents
 * are persistent, so an untouched table/grid/image keeps the exact same node
 * object across transactions, and one that WAS edited gets a new one. */
function toolbarStateEqual(a: ToolbarState, b: ToolbarState): boolean {
  return (
    a.format.bold === b.format.bold &&
    a.format.italic === b.format.italic &&
    a.format.underline === b.format.underline &&
    a.align === b.align &&
    a.color === b.color &&
    a.blockType === b.blockType &&
    a.clearable === b.clearable &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.inlineEditable === b.inlineEditable &&
    a.hasSelection === b.hasSelection &&
    a.listType === b.listType &&
    a.reorderModeActive === b.reorderModeActive &&
    a.link.href === b.link.href &&
    a.link.target === b.link.target &&
    a.link.active === b.link.active &&
    a.link.disabled === b.link.disabled &&
    nodeRefEqual(a.selectedImage, b.selectedImage) &&
    nodeRefEqual(a.selectedTable, b.selectedTable) &&
    nodeRefEqual(a.selectedGrid, b.selectedGrid)
  );
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

/** Marks the transaction that pulls an externally-changed `value` INTO the
 * editor, so `dispatchTransaction` knows not to turn around and report the
 * same value back out through `onChange`. Without it the parent gets an echo
 * of its own write - harmless when it stores the HTML verbatim (the ref check
 * in the sync effect below settles it after one extra round trip), but a
 * parent that normalizes/sanitizes what it's handed would bounce a slightly
 * different string back here, and this hook would bounce its own export back
 * again, indefinitely. */
const EXTERNAL_SYNC_META = "dryExternalValueSync";

/**
 * How long typing has to pause before the parent form is handed the new HTML.
 *
 * Notifying it is cheap here but expensive there - the entry form re-renders
 * every field it has - and doing that synchronously, inside the keystroke,
 * breaks the *rewriting* Vietnamese IMEs (EVKey / OpenKey / Unikey /
 * GoTiengViet - what most people actually use, and unlike macOS's built-in
 * Telex these use no composition at all). They don't send one edit per
 * keystroke: pressing "j" on "nôi" makes the IME backspace over what it
 * already committed and re-insert "nội", several separate DOM edits within a
 * millisecond or two. A re-render landing between two of them loses the ones
 * still queued, and the accent ends up duplicated or misplaced - "nội dung"
 * comes out "noọội dung".
 *
 * Measured over eight runs of the same emulated EVKey key stream, on the
 * entry editor: 5/8 correct when `onChange` is called synchronously, 8/8 when
 * it isn't called at all - with the full document serialization still running
 * either way, so it is the parent's re-render that does the damage, not the
 * export. Debounced (not throttled): a burst must not be interrupted at all,
 * so the timer restarts on every edit and only fires once typing settles.
 *
 * 150ms is comfortably longer than any IME's own rewrite burst and shorter
 * than any pause a human leaves between words. Everything that needs the
 * value sooner flushes explicitly - see `flushValue`'s call sites (blur,
 * composition end, unmount).
 */
const VALUE_FLUSH_DELAY_MS = 150;

/** Swaps the whole live document for `value`'s - shared by the external-value
 * sync effect below and the IME-composition flush that has to defer it (see
 * both call sites). */
function replaceDocWithValue(view: EditorView, value: string) {
  const nextDoc = withTrailingParagraph(value ? importCleanHtml(value) : createEmptyDoc());
  view.dispatch(
    view.state.tr
      .replaceWith(0, view.state.doc.content.size, nextDoc.content)
      .setMeta(EXTERNAL_SYNC_META, true),
  );
}

function buildAttributes(state: EditorState, disabled: boolean, label: string) {
  const reorderActive = isReorderActive(state);
  return {
    class: `dry-tx-content${reorderActive ? " dry-tx-reorder-active" : ""}`,
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": label,
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
  label,
  disabled,
  inline = false,
  onPastedImages,
}: UseRichTextEditorOptions): UseRichTextEditorResult {
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPastedImagesRef = useRef(onPastedImages);
  onPastedImagesRef.current = onPastedImages;
  /** The last HTML this hook itself produced (either the initial seed, or
   * `dispatchTransaction`'s own `onChange` echo) - lets the sync effect
   * below tell "the parent just reflected back what we told it" (a no-op,
   * must NOT touch the live doc/cursor) apart from "the parent changed
   * `value` out from under us" (Magic Write's own live per-field commit,
   * or a plain "Reset all"/"Clear all" - both need the visible editor to
   * actually update, which nothing did before this ref existed: the mount
   * effect right below only ever seeds `value` ONCE, by design, for normal
   * typing - see its own doc comment - which silently ate every OTHER
   * source of an external value change too). */
  const lastSyncedValueRef = useRef<string | null>(null);
  /** An external `value` that arrived while an IME composition was live -
   * rebuilding the document under the composing text node kills the
   * composition outright, so the sync effect below parks it here and the
   * composition-end flush (in the mount effect) applies it instead. */
  const pendingExternalValueRef = useRef<string | null>(null);
  // Read inside `dispatchTransaction` below via `.current`, same reason
  // `onChangeRef` is - that closure is built once, inside the mount effect
  // that only ever runs on `[]` (see its own doc comment), so a later
  // `inline` prop change needs a ref to actually reach it instead of a
  // stale value baked in at mount.
  const inlineRef = useRef(inline);
  inlineRef.current = inline;
  /** Same reason as `inlineRef`, plus one of its own: the mount effect below
   * seeds the document only AFTER an async component-registry fetch, and
   * `value` can change while that's in flight (a slow registry + a fast
   * `dry:field-set`/Magic Write). Seeding from the closure's own `value`
   * dropped that newer one for good - the sync effect further down had
   * already run and bailed on `viewRef.current` still being null. */
  const valueRef = useRef(value);
  valueRef.current = value;

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
  const [loading, setLoading] = useState(true);

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
    let htmlReorderSurface: HtmlReorderSurface | null = null;
    /** Set when a document-changing transaction was swallowed mid-composition
     * (see `dispatchTransaction`), so the flush that runs once the
     * composition ends knows it still owes the parent an `onChange`. */
    let pendingCompositionChange = false;
    let compositionFlushTimer = -1;
    /** Pending debounce timer for `flushValue` below, or -1. */
    let pendingValueTimer = -1;
    /** `flushValue` itself, hoisted to this effect's scope (same reason
     * `view` is) so the synchronous cleanup below can reach a function only
     * defined once the async body further down has run. */
    let flushPendingValue: (() => void) | null = null;
    /** Same, for the document-level listener the cleanup has to remove. */
    let removeOutsidePressFlush: (() => void) | null = null;

    void (async () => {
      const components = await loadRichtextComponents();
      if (cancelled) return;

      setRichtextComponents(components);
      const dryNodeViews: Record<string, (node: PMNode, editorView: EditorView, getPos: () => number | undefined) => DryComponentNodeView> = {};
      defineBuiltComponents(basePath, components);
      for (const component of flattenDryComponentRecords(components)) {
        const tag = `dry-${component.name}`;
        dryNodeViews[`dry_${component.name}`] = (node, editorView, getPos) =>
          new DryComponentNodeView(node, tag, component.type, component.children, editorView, getPos);
      }

    // Shadow-isolates the editable surface's own styling from the host
    // app/page's CSS in both directions - see `content-shadow-styles.ts`
    // for what that stylesheet has to independently supply as a result
    // (everything `dry.base`'s global element resets used to give it for
    // free). `mountEl` itself (`.richtext-content-host`) stays a normal
    // light-DOM element - only what's *inside* it moves into the shadow
    // tree, so the toolbar/floating menus/dialogs elsewhere in this field
    // are untouched and keep using the app's own global styles as before.
    // The placeholder/"Loading…" text (`RichTextField.tsx`) deliberately
    // lives OUTSIDE this shadow tree, as a sibling in `.richtext-content-
    // mount` - a plain light-DOM node is easy to select/assert on (devtools,
    // Playwright, ...), unlike the old shadow-only `::before` pseudo-element
    // this replaced.
    // HMR can remount this hook on the same host element. A shadow root is
    // permanent for that element, so calling attachShadow() again throws and
    // aborts the whole editor (leaving dry components at 0x0). Reuse the
    // existing root and clear the previous editor/style nodes before mounting.
    const shadowRoot = mountEl.shadowRoot ?? mountEl.attachShadow({ mode: "open" });
    shadowRoot.replaceChildren();
    const styleEl = document.createElement("style");
    styleEl.textContent = richtextContentShadowStyles;
    shadowRoot.appendChild(styleEl);
    // A plain pass-through container for `EditorView` to append its own
    // ".dry-tx-content" contenteditable into (the "place a fresh mount
    // node" constructor form - `EditorView` doesn't take the shadow root
    // itself). Needs its own `height: 100%` in the shadow stylesheet: it's
    // `.dry-tx-content`'s real DOM parent (and so its containing block
    // for `height: 100%` to resolve against there in turn), sitting between
    // it and the shadow host `.richtext-content-host`.
    const editorHost = document.createElement("div");
    editorHost.className = "dry-tx-content-host";
    shadowRoot.appendChild(editorHost);

    // `valueRef`, not the closure's `value` - see its own doc comment.
    const seedValue = valueRef.current;
    let doc = createEmptyDoc();
    if (seedValue) {
      try {
        doc = importCleanHtml(seedValue);
      } catch (err) {
        console.error("[drycms] Failed to parse RichTextField value", err);
      }
    }
    doc = withTrailingParagraph(doc);
    lastSyncedValueRef.current = seedValue;

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
          // Same commands `toolbar-buttons.ts`'s own bold/italic/underline
          // buttons run - without these, the browser's Ctrl/Cmd+B/I/U never
          // reaches ProseMirror's own doc model at all (nothing else in this
          // keymap or `baseKeymap` below claims them), so the keystroke is a
          // silent no-op: no visible change, and nothing for a later
          // transaction (e.g. applying a color) to have ever touched.
          "Mod-b": toggleMark(schema.marks.bold!),
          "Mod-i": toggleMark(schema.marks.italic!),
          "Mod-u": toggleMark(schema.marks.underline!),
          "Ctrl-Space": removeAllMarks(),
          "Shift-Mod-n": setBlockTypeCommand("paragraph"),
          "Shift-Mod-l": toggleList(schema.nodes.bullet_list!),
          "Mod-.": toggleList(schema.nodes.ordered_list!),
          "Mod-l": setTextAlign("left"),
          "Mod-e": setTextAlign("center"),
          "Mod-r": setTextAlign("right"),
          "Mod-j": setTextAlign("justify"),
          "Mod-Alt-c": openRichTextShortcut("color"),
          "Mod-k": openRichTextShortcut("link"),
          "Mod-Alt-m": openRichTextShortcut("image"),
          "Shift-Mod-f": openRichTextShortcut("fullscreen"),
          "Mod-Alt-g": insertGrid(),
          "Mod-Alt-t": insertTable(),
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
        trailingParagraph(),
      ],
    });

    /** Publishes everything OUTSIDE the `EditorView` that a transaction can
     * affect: the toolbar's live state, the placeholder's emptiness flag,
     * and - when the document actually changed - the exported HTML the
     * parent form holds. Split out of `dispatchTransaction` because a
     * composition (below) has to defer all of it to a single call at the
     * end, rather than run it per keystroke. */
    /** Hands the current document to the parent form as HTML, now - see
     * `VALUE_FLUSH_DELAY_MS` for why this is normally debounced instead.
     * Reads `view.state` rather than a captured document, so a debounced run
     * always reports the newest one. */
    const flushValue = () => {
      if (pendingValueTimer >= 0) {
        clearTimeout(pendingValueTimer);
        pendingValueTimer = -1;
      }
      if (!view || view.isDestroyed) return;
      const html = exportCleanHtml(view.state.doc, { inline: inlineRef.current });
      if (html === lastSyncedValueRef.current) return;
      lastSyncedValueRef.current = html;
      onChangeRef.current(html);
    };
    flushPendingValue = flushValue;

    const scheduleValueFlush = () => {
      if (pendingValueTimer >= 0) clearTimeout(pendingValueTimer);
      pendingValueTimer = window.setTimeout(() => {
        pendingValueTimer = -1;
        flushValue();
      }, VALUE_FLUSH_DELAY_MS);
    };

    /** Any press anywhere else on the page - the topbar's Save button above
     * all - settles the debounced value first, in the capture phase, so it is
     * in the parent's hands a whole task before that button's own click
     * handler reads it. `blur` alone (below) is later and, for a control that
     * doesn't take focus, may not come at all. Costs nothing when there's
     * nothing pending, which is every press that isn't right after typing. */
    const flushBeforeOutsidePress = () => {
      if (pendingValueTimer >= 0) flushValue();
    };
    document.addEventListener("pointerdown", flushBeforeOutsidePress, true);
    removeOutsidePressFlush = () =>
      document.removeEventListener("pointerdown", flushBeforeOutsidePress, true);

    /** Publishes everything OUTSIDE the `EditorView` that a transaction can
     * affect: the toolbar's live state, the placeholder's emptiness flag,
     * and - when the document actually changed - the exported HTML the
     * parent form holds. Split out of `dispatchTransaction` because a
     * composition (below) has to defer all of it to a single call at the
     * end, rather than run it per keystroke. The toolbar half stays
     * synchronous: it only ever re-renders this field (and only when
     * `toolbarStateEqual` says something actually changed), which measured
     * clean under the same IME stress the parent re-render fails. */
    const flushEditorState = (state: EditorState, docChanged: boolean) => {
      pendingCompositionChange = false;
      const nextToolbarState = readToolbarState(state);
      setState((current) => (toolbarStateEqual(current, nextToolbarState) ? current : nextToolbarState));
      setEmpty(isDocEmpty(state));
      if (docChanged) scheduleValueFlush();
    };

    view = new EditorView(editorHost, {
      state: editorState,
      editable: (state) => !disabled && !isReorderActive(state),
      attributes: (state) => buildAttributes(state, disabled, label),
      nodeViews: {
        image: (node, editorView, getPos) => new ImageNodeView(node, editorView, getPos),
        table: (node) => new TableNodeView(node),
        grid_item: (node, editorView, getPos) => new GridItemNodeView(node, editorView, getPos),
        ...dryNodeViews,
      },
      handlePaste: (editorView, event) => {
        if (!event.clipboardData || !onPastedImagesRef.current) return false;
        const images = pastedImagesFromClipboard(event.clipboardData);
        if (!images.length) return false;

        const hasImageFiles = images.some((image) => !!image.file);
        const htmlHasImages = /<img\b/i.test(event.clipboardData.getData("text/html"));
        if (hasImageFiles || !htmlHasImages) {
          event.preventDefault();
          insertPastedImageFiles(editorView, images);
        }
        onPastedImagesRef.current(images);
        return hasImageFiles || !htmlHasImages;
      },
      transformPastedHTML: sanitizePastedHtml,
      handleDOMEvents: {
        // Focus leaving the editor is when everything else on the page is
        // about to read the value - clicking Save in the topbar blurs this
        // first - so the debounced flush must not still be pending.
        blur: () => {
          flushValue();
          return false;
        },
        // `compositionend` clears `view.composing` synchronously, but the
        // composition's own final DOM changes only reach
        // `dispatchTransaction` a microtask later (prosemirror-view flushes
        // its pending mutation records there) or up to 20ms later (its
        // `endComposition` timer) - either one flushes the held-back change
        // for us, since `view.composing` is already false by then. This
        // timer is only the backstop for a composition that ends WITHOUT
        // producing another transaction at all (cancelled with Escape, or
        // confirmed with no net change), which would otherwise leave the
        // deferred `onChange` owing forever.
        compositionend: () => {
          clearTimeout(compositionFlushTimer);
          compositionFlushTimer = window.setTimeout(() => {
            if (!view || view.isDestroyed || view.composing) return;
            const pendingValue = pendingExternalValueRef.current;
            pendingExternalValueRef.current = null;
            if (pendingValue !== null) {
              // Dispatches its own transaction, which flushes on its way out.
              try {
                replaceDocWithValue(view, pendingValue);
              } catch (err) {
                console.error("[drycms] Failed to sync external RichTextField value", err);
              }
              return;
            }
            flushEditorState(view.state, pendingCompositionChange);
          }, 30);
          return false;
        },
      },
      dispatchTransaction(tr) {
        // Non-null: only ever invoked after the `view =` assignment right
        // below completes (ProseMirror never calls it during construction
        // itself) - `let view: EditorView | null` (not `const`, see this
        // effect's own doc comment above) means TS can't narrow that across
        // this closure the way it could have for the old synchronous body's
        // `const view`.
        const wasReorderActive = isReorderActive(view!.state);
        const newState = view!.state.apply(tr);
        view!.updateState(newState);
        // A live IME composition is NOT one keystroke: Vietnamese Telex/VNI
        // (like the CJK IMEs) composes a whole syllable, and
        // prosemirror-view's DOM observer flushes on every mutation the IME
        // makes along the way - so "tieengs" -> "tiếng" arrives here as one
        // transaction per letter, all while the composition is still open.
        // Serializing the entire document to HTML and pushing it up through
        // `onChange` on each of those re-rendered this field AND the whole
        // entry form around it (which re-serializes/diffs the entry, see
        // `ContentEntryEditor.tsx`) once per letter, mid-composition: slow
        // enough on a real document to visibly stall typing, and every one
        // of those renders is another chance for something to touch the DOM
        // around the very text node the IME is still composing into - which
        // drops the composition and leaves the half-typed syllable stuck.
        // Nobody outside this editor has any use for the intermediate,
        // pre-composition text anyway, so all of it is held back and flushed
        // exactly once when the composition ends (see `compositionend`).
        if (view!.composing) {
          pendingCompositionChange ||= tr.docChanged;
          return;
        }
        // An external-sync transaction is this hook applying the parent's own
        // `value` - reporting it back would be an echo (see `EXTERNAL_SYNC_META`).
        const external = tr.getMeta(EXTERNAL_SYNC_META) === true;
        flushEditorState(newState, !external && (tr.docChanged || pendingCompositionChange));
        const reorderActive = isReorderActive(newState);
        htmlReorderSurface?.setActive(
          reorderActive,
          reorderActive && !wasReorderActive ? exportCleanHtml(newState.doc, { inline: inlineRef.current }) : undefined,
        );
      },
    });
    viewRef.current = view;
    htmlReorderSurface = new HtmlReorderSurface(editorHost, (html) => {
      const current = viewRef.current;
      if (!current) return;
      try {
        const nextDoc = withTrailingParagraph(importCleanHtml(html));
        const tr = current.state.tr
          .replaceWith(0, current.state.doc.content.size, nextDoc.content)
          .setMeta(reorderModeKey, { active: false });
        current.dispatch(tr.scrollIntoView());
      } catch (error) {
        console.error("[drycms] Failed to commit RichText reorder", error);
      }
    });
    setState(readToolbarState(editorState));
    setEmpty(isDocEmpty(editorState));
    setLoading(false);
    })();

    return () => {
      cancelled = true;
      clearTimeout(compositionFlushTimer);
      // Before tearing the view down: a debounced value change still pending
      // when the field unmounts (route change, dialog close) is the user's
      // last keystrokes, and nothing else is left to report them.
      flushPendingValue?.();
      removeOutsidePressFlush?.();
      // Only set if the async work above had already reached
      // `new EditorView(...)` before this ran - a mount cancelled while
      // still awaiting `loadRichtextComponents()` never got that far, and
      // `cancelled` (checked right after that `await`) stops it from
      // starting to build one at all.
      if (view) {
        htmlReorderSurface?.destroy();
        view.destroy();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once, see comment above
  }, []);

  // `disabled`/`label` can change after mount without a full remount -
  // ProseMirror owns this dom node now, so pushing the update through
  // `setProps` (rather than relying on Preact's own re-render) is what
  // actually applies it.
  useEffect(() => {
    viewRef.current?.setProps({
      editable: (state) => !disabled && !isReorderActive(state),
      attributes: (state) => buildAttributes(state, disabled, label),
    });
  }, [disabled, label]);

  // Re-syncs the live doc when `value` changes for a reason OTHER than this
  // hook's own `dispatchTransaction` echoing it straight back (normal
  // typing) - Magic Write's live per-field commit and a plain "Reset all"/
  // "Clear all" both just assign a new `value` prop from outside, same as
  // any other field, and until this effect existed nothing ever pulled that
  // back into the already-mounted `EditorView` (see the mount effect's own
  // doc comment: `value` there only ever seeds the INITIAL document).
  // Replaces the whole doc rather than diffing - simple, and the only two
  // real callers here (a full AI rewrite of the field, a full reset to the
  // saved/blank value) are already whole-value replacements themselves, not
  // incremental edits a naive full-replace would make janky.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastSyncedValueRef.current) return;
    lastSyncedValueRef.current = value;
    // Replacing the document tears down and rebuilds its DOM, including the
    // text node an open IME composition is writing into - doing that
    // mid-composition drops the composition and strands the half-typed
    // syllable. Park it and let the composition-end handler above apply it
    // (a composition always ends, including on blur).
    if (view.composing) {
      pendingExternalValueRef.current = value;
      return;
    }
    try {
      replaceDocWithValue(view, value);
    } catch (err) {
      console.error("[drycms] Failed to sync external RichTextField value", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `value` should trigger a resync; `loading` isn't in scope to gate on and `viewRef` is a ref
  }, [value]);

  return { contentRef, viewRef, state, empty, loading };
}
