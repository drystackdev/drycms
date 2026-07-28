import { useEffect, useRef, useState } from "preact/hooks";
import { registerPlainText } from "@lexical/plain-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_EDITOR,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import type { FieldProps } from "./field-common.js";

/** Only the 3 inline marks this field supports, so the export is exactly
 * `<p>`/`<strong>`/`<em>`/`<u>`/`<br>` and plain text - no theme classes, no
 * `white-space` styling, no `@lexical/html` (which wraps every run in extra
 * markup for round-tripping node types this field will never have). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function $exportCleanHtml(): string {
  return $getRoot()
    .getChildren()
    .map((node) => {
      if (!$isParagraphNode(node)) return "";
      const inner = node
        .getChildren()
        .map((child) => {
          if ($isLineBreakNode(child)) return "<br>";
          if (!$isTextNode(child)) return "";
          let text = escapeHtml(child.getTextContent());
          if (child.hasFormat("bold")) text = `<strong>${text}</strong>`;
          if (child.hasFormat("italic")) text = `<em>${text}</em>`;
          if (child.hasFormat("underline")) text = `<u>${text}</u>`;
          return text;
        })
        .join("");
      return `<p>${inner}</p>`;
    })
    .join("");
}

interface InlineAncestry {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function $walkInlineHtml(domNode: ChildNode, ancestry: InlineAncestry): LexicalNode[] {
  if (domNode.nodeType === Node.TEXT_NODE) {
    const text = domNode.textContent ?? "";
    if (!text) return [];
    const textNode = $createTextNode(text);
    if (ancestry.bold) textNode.toggleFormat("bold");
    if (ancestry.italic) textNode.toggleFormat("italic");
    if (ancestry.underline) textNode.toggleFormat("underline");
    return [textNode];
  }
  if (domNode.nodeName === "BR") return [$createLineBreakNode()];
  if (domNode.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = domNode.nodeName;
  const nextAncestry: InlineAncestry = {
    bold: ancestry.bold || tag === "STRONG" || tag === "B",
    italic: ancestry.italic || tag === "EM" || tag === "I",
    underline: ancestry.underline || tag === "U",
  };
  return Array.from(domNode.childNodes).flatMap((child) => $walkInlineHtml(child, nextAncestry));
}

/** Accepts this field's own clean export, or any simple hand-written HTML
 * using the same handful of tags - unrecognized wrapper elements are just
 * unwrapped rather than rejected. */
function $importCleanHtml(html: string): void {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const root = $getRoot();
  const blocks = dom.body.children.length > 0 ? Array.from(dom.body.children) : [dom.body];
  const noFormat: InlineAncestry = { bold: false, italic: false, underline: false };
  for (const block of blocks) {
    const paragraph = $createParagraphNode();
    const inlineNodes = Array.from(block.childNodes).flatMap((child) => $walkInlineHtml(child, noFormat));
    paragraph.append(...inlineNodes);
    root.append(paragraph);
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

export interface RichTextFieldProps extends FieldProps<string> {
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  /** Report/seed `value` as an HTML string instead of Lexical's JSON editor
   * state. @default false */
  outHTML?: boolean;
}

type InlineFormat = "bold" | "italic" | "underline";

interface ActiveFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

const NO_FORMAT: ActiveFormat = { bold: false, italic: false, underline: false };

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
  outHTML = true,
  class: className,
  style,
}: RichTextFieldProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const outHTMLRef = useRef(outHTML);
  outHTMLRef.current = outHTML;
  const [format, setFormat] = useState<ActiveFormat>(NO_FORMAT);
  const [empty, setEmpty] = useState(true);

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
      setFormat(
        $isRangeSelection(selection)
          ? {
              bold: selection.hasFormat("bold"),
              italic: selection.hasFormat("italic"),
              underline: selection.hasFormat("underline"),
            }
          : NO_FORMAT,
      );
    };

    const unregisterFns = [
      // Core Lexical dispatches commands for typing/backspace/paste/etc. but
      // registers no handlers for them - registerPlainText supplies that
      // baseline (Enter becomes a soft line break, not a new block), leaving
      // just the FORMAT_TEXT_COMMAND (toolbar) wiring to do ourselves below.
      registerPlainText(editor),
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
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          readSelectionFormat();
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

  const applyFormat = (type: InlineFormat) => {
    contentRef.current?.focus();
    editorRef.current?.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  };

  // Keeps the current selection alive - a plain click would blur the
  // contenteditable and collapse it before the click handler ever runs.
  const preserveSelection = (event: MouseEvent) => event.preventDefault();

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="richtext" aria-invalid={error || undefined}>
        <div class="richtext-toolbar" role="group" aria-label="Formatting">
          <button
            type="button"
            class="ghost icon sm"
            aria-pressed={format.bold}
            aria-label="Bold"
            disabled={disabled}
            onMouseDown={preserveSelection}
            onClick={() => applyFormat("bold")}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            class="ghost icon sm"
            aria-pressed={format.italic}
            aria-label="Italic"
            disabled={disabled}
            onMouseDown={preserveSelection}
            onClick={() => applyFormat("italic")}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            class="ghost icon sm"
            aria-pressed={format.underline}
            aria-label="Underline"
            disabled={disabled}
            onMouseDown={preserveSelection}
            onClick={() => applyFormat("underline")}
          >
            <u>U</u>
          </button>
        </div>
        <div
          ref={contentRef}
          class={`richtext-content${empty ? " is-empty" : ""}`}
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          data-placeholder={placeholder}
        />
      </div>
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}
    </div>
  );
}
