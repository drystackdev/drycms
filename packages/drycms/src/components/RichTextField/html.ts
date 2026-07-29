import type { Node as PMNode } from "prosemirror-model";
import {
  blockNodeTypeAndAttrs,
  blockTypeFromTagName,
  blockTypeOfNode,
  createEmptyDoc,
  imageSizeFromElement,
  imageStyleString,
  parseImageAlign,
  schema,
  type ImageAlign,
} from "./schema.js";
import { normalizeTextAlign, type BlockType } from "./types.js";

/**
 * RichTextField's own HTML <-> ProseMirror doc conversion (rewritten from
 * the Lexical version of this file, same file name/shape). Only the marks
 * this field's toolbar can produce need to survive the trip: `<strong>`,
 * `<em>`, `<u>`, a `<span style="color: ...">` (see color-menu.tsx), `<br>`,
 * an inline `<img>` (see schema.ts), plain text, one block element (`<p>`,
 * `<h2>`-`<h6>`, `<blockquote>`) per top-level element.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function blockTag(type: BlockType): string {
  if (type === "quote") return "blockquote";
  if (type === "paragraph") return "p";
  return type;
}

function textNodeToHtml(node: PMNode): string {
  let text = escapeHtml(node.text ?? "");
  if (schema.marks.bold!.isInSet(node.marks)) text = `<strong>${text}</strong>`;
  if (schema.marks.italic!.isInSet(node.marks)) text = `<em>${text}</em>`;
  if (schema.marks.underline!.isInSet(node.marks)) text = `<u>${text}</u>`;
  const colorMark = schema.marks.textColor!.isInSet(node.marks);
  if (colorMark) text = `<span style="color: ${escapeAttr(colorMark.attrs.value as string)}">${text}</span>`;
  return text;
}

export function exportCleanHtml(doc: PMNode): string {
  const parts: string[] = [];
  doc.forEach((node) => {
    const tag = blockTag(blockTypeOfNode(node));
    const align = (node.attrs.textAlign as string | null) ?? "left";
    const style = align === "left" ? "" : ` style="text-align: ${align}"`;
    let inner = "";
    node.forEach((child) => {
      if (child.type === schema.nodes.image) {
        const style = imageStyleString(
          child.attrs.width as number | null,
          child.attrs.height as number | null,
          child.attrs.align as ImageAlign | null,
        );
        inner += `<img src="${escapeAttr(child.attrs.src as string)}" alt="${escapeAttr(child.attrs.alt as string)}"${style ? ` style="${escapeAttr(style)}"` : ""}>`;
      } else if (child.type === schema.nodes.hard_break) {
        inner += "<br>";
      } else if (child.isText) {
        inner += textNodeToHtml(child);
      }
    });
    parts.push(`<${tag}${style}>${inner}</${tag}>`);
  });
  return parts.join("");
}

interface InlineAncestry {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** CSS `color` value, or `""` for none - a nested element's own `color`
   * replaces rather than combines with the ancestor's. */
  color: string;
}

const NO_MARKS: InlineAncestry = { bold: false, italic: false, underline: false, color: "" };

function walkInlineHtml(domNode: ChildNode, ancestry: InlineAncestry): PMNode[] {
  if (domNode.nodeType === Node.TEXT_NODE) {
    const text = domNode.textContent ?? "";
    if (!text) return [];
    const marks = [];
    if (ancestry.bold) marks.push(schema.marks.bold!.create());
    if (ancestry.italic) marks.push(schema.marks.italic!.create());
    if (ancestry.underline) marks.push(schema.marks.underline!.create());
    if (ancestry.color) marks.push(schema.marks.textColor!.create({ value: ancestry.color }));
    return [schema.text(text, marks)];
  }
  if (domNode.nodeName === "BR") return [schema.nodes.hard_break!.create()];
  if (domNode.nodeName === "IMG") {
    const img = domNode as HTMLImageElement;
    return [
      schema.nodes.image!.create({
        src: img.getAttribute("src") ?? "",
        alt: img.getAttribute("alt") ?? "",
        ...imageSizeFromElement(img),
        align: parseImageAlign(img),
      }),
    ];
  }
  if (domNode.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = domNode.nodeName;
  const nextAncestry: InlineAncestry = {
    bold: ancestry.bold || tag === "STRONG" || tag === "B",
    italic: ancestry.italic || tag === "EM" || tag === "I",
    underline: ancestry.underline || tag === "U",
    color: (domNode instanceof HTMLElement && domNode.style.color) || ancestry.color,
  };
  return Array.from(domNode.childNodes).flatMap((child) => walkInlineHtml(child, nextAncestry));
}

/** Accepts this field's own clean export, or any simple hand-written HTML
 * using the same handful of tags - unrecognized wrapper elements are just
 * unwrapped rather than rejected. */
export function importCleanHtml(html: string): PMNode {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const blocks = dom.body.children.length > 0 ? Array.from(dom.body.children) : [dom.body];
  const blockNodes: PMNode[] = [];
  for (const block of blocks) {
    // A bare top-level `<img>` (hand-written HTML, never something this
    // field's own export produces) has no block wrapper to carry it -
    // synthesize the paragraph it'd otherwise have lived in.
    if (block.tagName === "IMG") {
      const img = block as HTMLImageElement;
      blockNodes.push(
        schema.nodes.paragraph!.create(
          null,
          schema.nodes.image!.create({
            src: img.getAttribute("src") ?? "",
            alt: img.getAttribute("alt") ?? "",
            ...imageSizeFromElement(img),
            align: parseImageAlign(img),
          }),
        ),
      );
      continue;
    }
    const { type, attrs } = blockNodeTypeAndAttrs(blockTypeFromTagName(block.tagName));
    const align = normalizeTextAlign(block instanceof HTMLElement ? block.style.textAlign : undefined);
    const finalAttrs = align !== "left" ? { ...(attrs ?? {}), textAlign: align } : attrs;
    const inlineNodes = Array.from(block.childNodes).flatMap((child) => walkInlineHtml(child, NO_MARKS));
    blockNodes.push(type.create(finalAttrs, inlineNodes));
  }
  if (blockNodes.length === 0) return createEmptyDoc();
  return schema.nodes.doc!.create(null, blockNodes);
}
