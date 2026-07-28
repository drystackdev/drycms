import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { registerPlainText } from "@lexical/plain-text";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { $getSelectionStyleValueForProperty } from "@lexical/selection";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  SELECTION_CHANGE_COMMAND,
  createEditor,
  type ElementNode,
  type LexicalEditor,
  type SerializedEditorState,
} from "lexical";
import { $createBlockNode, $getBlockType, FORMAT_BLOCK_TYPE_COMMAND, HeadingNode, QuoteNode } from "./block-nodes.js";
import { $exportCleanHtml, $importCleanHtml } from "./html.js";
import { NO_FORMAT, normalizeTextAlign, type ToolbarState } from "./types.js";

export interface UseRichTextEditorOptions {
  /** HTML string - always the primary seed when non-empty (see `json`
   * below for the fallback). Reported on every change via `onChange`. */
  value: string;
  onChange: (value: string) => void;
  /** Lexical's serialized editor state, as an object rather than a JSON
   * string - optional secondary seed/report pair alongside `value`/
   * `onChange`. Only used to seed the document when `value` is empty. */
  json?: SerializedEditorState;
  onJsonChange?: (json: SerializedEditorState) => void;
}

export interface UseRichTextEditorResult {
  contentRef: RefObject<HTMLDivElement>;
  editorRef: RefObject<LexicalEditor | null>;
  state: ToolbarState;
  empty: boolean;
}

/**
 * Owns the Lexical editor's whole lifecycle: creation, seeding `value`,
 * registering plugins/commands, and tracking whatever live state the
 * toolbar (`./toolbar-buttons.ts`) needs to read. A future feature that
 * needs a new `@lexical/*` plugin or a new piece of toolbar-visible state
 * belongs here - `RichTextField.tsx` itself should stay a thin
 * props-in/JSX-out wrapper around this hook.
 */
export function useRichTextEditor({
  value,
  onChange,
  json,
  onJsonChange,
}: UseRichTextEditorOptions): UseRichTextEditorResult {
  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onJsonChangeRef = useRef(onJsonChange);
  onJsonChangeRef.current = onJsonChange;

  const [format, setFormat] = useState(NO_FORMAT);
  const [align, setAlign] = useState<ToolbarState["align"]>("left");
  const [color, setColor] = useState("");
  const [blockType, setBlockType] = useState<ToolbarState["blockType"]>("paragraph");
  const [empty, setEmpty] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Editor state is owned by Lexical after mount; `value` only seeds the
  // initial document, matching how every Lexical framework binding treats
  // "controlled" rich text (re-parsing on each keystroke would fight the
  // caret/selection).
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const editor = createEditor({
      namespace: "drycms-richtext",
      onError: (err) => console.error(err),
      nodes: [HeadingNode, QuoteNode],
      theme: {
        // Lexical's DOM tag for a text run is picked by priority (bold beats
        // italic beats plain <span>), so a bold+italic run only gets <strong>
        // - italic's own tag is dropped. Theme classes apply per-format
        // regardless of which single tag won, so every format gets one
        // rather than relying on the semantic tag alone.
        text: { bold: "rte-bold", italic: "rte-italic", underline: "rte-underline" },
      },
    });
    editorRef.current = editor;
    editor.setRootElement(contentEl);

    let seeded = false;
    if (value) {
      try {
        editor.update(() => $importCleanHtml(value));
        seeded = true;
      } catch (err) {
        console.error("[drycms] Failed to parse RichTextField value", err);
      }
    } else if (json) {
      try {
        editor.setEditorState(editor.parseEditorState(json));
        seeded = true;
      } catch (err) {
        console.error("[drycms] Failed to parse RichTextField json", err);
      }
    }
    if (!seeded) {
      editor.update(() => {
        $getRoot().append($createParagraphNode());
      });
    }

    const readSelectionFormat = () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        setFormat(NO_FORMAT);
        setColor("");
        return;
      }
      setFormat({
        bold: selection.hasFormat("bold"),
        italic: selection.hasFormat("italic"),
        underline: selection.hasFormat("underline"),
      });
      const element = selection.anchor.getNode().getTopLevelElementOrThrow();
      setAlign(normalizeTextAlign(element.getFormatType()));
      setColor($getSelectionStyleValueForProperty(selection, "color", ""));
      setBlockType($getBlockType(element));
    };

    const unregisterFns = [
      // Core Lexical dispatches commands for typing/backspace/paste/etc. but
      // registers no handlers for them - registerPlainText supplies that
      // baseline (Enter becomes a soft line break, not a new block), leaving
      // just the FORMAT_TEXT_COMMAND (toolbar) wiring to do ourselves below.
      registerPlainText(editor),
      // Same story for undo/redo: registerHistory is the typed history
      // system's own registrar (UNDO_COMMAND/REDO_COMMAND are core commands,
      // but nothing acts on them without this).
      registerHistory(editor, createEmptyHistoryState(), 300),
      editor.registerCommand(
        FORMAT_TEXT_COMMAND,
        (payload) => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.formatText(payload);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // Alignment lives on the paragraph (ElementNode), not the text run, so
      // there's no per-format-bit toggle here - just set every touched
      // top-level element to the requested alignment.
      editor.registerCommand(
        FORMAT_ELEMENT_COMMAND,
        (alignment) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const elements = new Set<ElementNode>();
          for (const node of selection.getNodes()) {
            const element = $isElementNode(node) ? node : node.getTopLevelElementOrThrow();
            if ($isElementNode(element)) elements.add(element);
          }
          for (const element of elements) element.setFormat(alignment);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // Like `FORMAT_ELEMENT_COMMAND` above, this touches whole top-level
      // elements - but changing block type needs a new node instance
      // (a `<p>` can't become a `<h2>` in place), so each touched element is
      // replaced rather than mutated. `replace(..., true)` carries the old
      // element's children over onto the new one.
      editor.registerCommand(
        FORMAT_BLOCK_TYPE_COMMAND,
        (blockType) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const elements = new Set<ElementNode>();
          for (const node of selection.getNodes()) {
            const element = $isElementNode(node) ? node : node.getTopLevelElementOrThrow();
            if ($isElementNode(element)) elements.add(element);
          }
          for (const element of elements) {
            if ($getBlockType(element) === blockType) continue;
            const replacement = $createBlockNode(blockType);
            replacement.setFormat(element.getFormatType());
            element.replace(replacement, true);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // registerPlainText's own KEY_ENTER_COMMAND handler (registered at
      // COMMAND_PRIORITY_EDITOR, see above) always inserts a soft line break
      // - there's no "new block" concept in plain-text mode. This field does
      // have block types (paragraph/heading/quote, see block-nodes.ts), so it
      // needs the richer split-into-a-new-block behavior instead - but a
      // Cmd/Ctrl+Enter should still fall through to a plain <br>, matching
      // the common "soft break vs. new paragraph" convention. Must run ahead
      // of registerPlainText's handler to intercept the plain-Enter case.
      editor.registerCommand<KeyboardEvent>(
        KEY_ENTER_COMMAND,
        (event) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event?.preventDefault();
          if (event?.ctrlKey || event?.metaKey) {
            selection.insertLineBreak();
          } else {
            selection.insertParagraph();
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      // A plain (non-Ctrl/Cmd) End keypress doesn't collapse-and-move the
      // caret in this editor: Lexical core's own default KEY_DOWN_COMMAND
      // handler (registered internally, ahead of anything below) doesn't
      // special-case End either, but unconditionally returns `true`, which
      // stops the command from reaching the browser's native default action
      // - so End silently becomes a no-op instead of falling through.  Left
      // alone, a selection built on End (e.g. "End, then Shift+Left x N" to
      // grab a trailing substring) silently selects the wrong range instead
      // - the caret stays wherever it already was. This has to run at a
      // higher priority than COMMAND_PRIORITY_EDITOR to get first look, and
      // `Selection.modify` reproduces the layout-aware line-boundary move
      // Home already gets natively - which, unlike a plain keypress here,
      // reliably fires `selectionchange` and syncs Lexical's model.
      editor.registerCommand<KeyboardEvent>(
        KEY_DOWN_COMMAND,
        (event) => {
          if (event.key !== "End" || event.ctrlKey || event.metaKey) return false;
          const domSelection = window.getSelection();
          if (!domSelection) return false;
          event.preventDefault();
          domSelection.modify(event.shiftKey ? "extend" : "move", "forward", "lineboundary");
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          readSelectionFormat();
          return false;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          readSelectionFormat();
          setEmpty($getRoot().getTextContent().length === 0);
        });
        onChangeRef.current(editorState.read(() => $exportCleanHtml()));
        onJsonChangeRef.current?.(editorState.toJSON());
      }),
    ];

    return () => {
      for (const unregister of unregisterFns) unregister();
      editor.setRootElement(null);
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once, see comment above
  }, []);

  return { contentRef, editorRef, state: { format, align, color, blockType, canUndo, canRedo }, empty };
}
