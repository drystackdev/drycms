import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type LexicalNode,
} from "lexical";
import { $blockTag, $blockTypeFromTagName, $createBlockNode, $getBlockType } from "./block-nodes.js";
import { normalizeTextAlign } from "./types.js";

/**
 * RichTextField's own HTML <-> node-tree conversion - kept separate from
 * `@lexical/html` (which round-trips arbitrary node types this field will
 * never have, wrapping every run in `<span style="white-space: pre-wrap;">`
 * plus a redundant `<b>`/`<i>` around the semantic tag). Only the marks this
 * field's toolbar can produce need to survive the trip: `<strong>`, `<em>`,
 * `<u>`, a `<span style="color: ...">` (see color-menu.tsx), `<br>`, plain
 * text, one block element (`<p>`, `<h2>`-`<h6>`, `<blockquote>` - see
 * `block-nodes.ts`) per top-level element.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** `TextNode.getStyle()` is a single free-form CSS string - this field only
 * ever writes a `color` property into it (see color-menu.tsx), so pulling
 * just that back out is enough to round-trip. */
function extractColor(style: string): string {
  return /color:\s*([^;]+)/i.exec(style)?.[1]?.trim() ?? "";
}

export function $exportCleanHtml(): string {
  return $getRoot()
    .getChildren()
    .map((node) => {
      if (!$isElementNode(node)) return "";
      const inner = node
        .getChildren()
        .map((child) => {
          if ($isLineBreakNode(child)) return "<br>";
          if (!$isTextNode(child)) return "";
          let text = escapeHtml(child.getTextContent());
          if (child.hasFormat("bold")) text = `<strong>${text}</strong>`;
          if (child.hasFormat("italic")) text = `<em>${text}</em>`;
          if (child.hasFormat("underline")) text = `<u>${text}</u>`;
          const color = extractColor(child.getStyle());
          if (color) text = `<span style="color: ${escapeAttr(color)}">${text}</span>`;
          return text;
        })
        .join("");
      // "left" is the default alignment - only non-default values need to
      // survive the round trip as an explicit style.
      const align = normalizeTextAlign(node.getFormatType());
      const style = align === "left" ? "" : ` style="text-align: ${align}"`;
      const tag = $blockTag($getBlockType(node));
      return `<${tag}${style}>${inner}</${tag}>`;
    })
    .join("");
}

interface InlineAncestry {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** CSS `color` value, or `""` for none - unlike the booleans above, a
   * nested element's own `color` replaces rather than ORs with the
   * ancestor's (see `nextAncestry` below). */
  color: string;
}

function $walkInlineHtml(domNode: ChildNode, ancestry: InlineAncestry): LexicalNode[] {
  if (domNode.nodeType === Node.TEXT_NODE) {
    const text = domNode.textContent ?? "";
    if (!text) return [];
    const textNode = $createTextNode(text);
    if (ancestry.bold) textNode.toggleFormat("bold");
    if (ancestry.italic) textNode.toggleFormat("italic");
    if (ancestry.underline) textNode.toggleFormat("underline");
    if (ancestry.color) textNode.setStyle(`color: ${ancestry.color}`);
    return [textNode];
  }
  if (domNode.nodeName === "BR") return [$createLineBreakNode()];
  if (domNode.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = domNode.nodeName;
  const nextAncestry: InlineAncestry = {
    bold: ancestry.bold || tag === "STRONG" || tag === "B",
    italic: ancestry.italic || tag === "EM" || tag === "I",
    underline: ancestry.underline || tag === "U",
    color: (domNode instanceof HTMLElement && domNode.style.color) || ancestry.color,
  };
  return Array.from(domNode.childNodes).flatMap((child) => $walkInlineHtml(child, nextAncestry));
}

/** Accepts this field's own clean export, or any simple hand-written HTML
 * using the same handful of tags - unrecognized wrapper elements are just
 * unwrapped rather than rejected. */
export function $importCleanHtml(html: string): void {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const root = $getRoot();
  const blocks = dom.body.children.length > 0 ? Array.from(dom.body.children) : [dom.body];
  const noFormat: InlineAncestry = { bold: false, italic: false, underline: false, color: "" };
  for (const block of blocks) {
    const element = $createBlockNode($blockTypeFromTagName(block.tagName));
    const align = normalizeTextAlign(
      block instanceof HTMLElement ? block.style.textAlign : undefined,
    );
    if (align !== "left") element.setFormat(align);
    const inlineNodes = Array.from(block.childNodes).flatMap((child) => $walkInlineHtml(child, noFormat));
    element.append(...inlineNodes);
    root.append(element);
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}
