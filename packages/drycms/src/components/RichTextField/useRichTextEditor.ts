import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { registerPlainText } from "@lexical/plain-text";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  createEditor,
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import { $exportCleanHtml, $importCleanHtml } from "./html.js";
import { NO_FORMAT, normalizeTextAlign, type ToolbarState } from "./types.js";

export interface UseRichTextEditorOptions {
  value: string;
  onChange: (value: string) => void;
  /** Report/seed `value` as an HTML string instead of Lexical's JSON editor
   * state. */
  outHTML: boolean;
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
export function useRichTextEditor({ value, onChange, outHTML }: UseRichTextEditorOptions): UseRichTextEditorResult {
  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const outHTMLRef = useRef(outHTML);
  outHTMLRef.current = outHTML;

  const [format, setFormat] = useState(NO_FORMAT);
  const [align, setAlign] = useState<ToolbarState["align"]>("left");
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
        if (outHTML) {
          editor.update(() => $importCleanHtml(value));
        } else {
          editor.setEditorState(editor.parseEditorState(value));
        }
        seeded = true;
      } catch (err) {
        console.error("[drycms] Failed to parse RichTextField value", err);
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
        return;
      }
      setFormat({
        bold: selection.hasFormat("bold"),
        italic: selection.hasFormat("italic"),
        underline: selection.hasFormat("underline"),
      });
      const element = selection.anchor.getNode().getTopLevelElementOrThrow();
      setAlign(normalizeTextAlign(element.getFormatType()));
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
        const output = outHTMLRef.current
          ? editorState.read(() => $exportCleanHtml())
          : JSON.stringify(editorState.toJSON());
        onChangeRef.current(output);
      }),
    ];

    return () => {
      for (const unregister of unregisterFns) unregister();
      editor.setRootElement(null);
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once, see comment above
  }, []);

  return { contentRef, editorRef, state: { format, align, canUndo, canRedo }, empty };
}
