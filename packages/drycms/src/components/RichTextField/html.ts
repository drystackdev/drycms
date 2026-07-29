import type { Node as PMNode } from "prosemirror-model";
import {
  blockNodeTypeAndAttrs,
  blockTypeFromTagName,
  blockTypeOfNode,
  createEmptyDoc,
  imageAlignStyleString,
  imageObjectFitFromElement,
  imageSizeAndFitStyleString,
  imageSizeFromElement,
  imageStyleString,
  parseImageAlign,
  schema,
  type ImageAlign,
  type ImageObjectFit,
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

/** An image child's own HTML - a bare `<img>` (size/fit + align both on the
 * one tag) when it has no caption, same as always; `<figure><img>...
 * <figcaption>...</figcaption></figure>` when it does. Size/fit stays on
 * the `<img>` either way, but align moves to the `<figure>` (the new
 * outermost box) once there's a second element - the figcaption - sharing
 * it, the same reason `image-view.ts`'s own wrapper `<span>` carries align
 * instead of the `<img>` it contains. `margin:0` resets the UA's own
 * default `<figure>` margin, which would otherwise stack with (or fight)
 * the align margins alongside it. Nesting a `<figure>` (flow content)
 * inside the caller's `<p>` is invalid HTML when the image shares its
 * paragraph with other inline content, but a browser's own error-recovery
 * parsing splits it into separate siblings without losing anything - same
 * tradeoff drystack's own `figureWrap` makes, and for the same reason:
 * dropping the caption instead would actively lose user content. */
function imageChildHtml(node: PMNode): string {
  const width = node.attrs.width as number | null;
  const height = node.attrs.height as number | null;
  const align = node.attrs.align as ImageAlign | null;
  const objectFit = node.attrs.objectFit as ImageObjectFit;
  const caption = node.attrs.caption as string;
  const src = escapeAttr(node.attrs.src as string);
  const alt = escapeAttr(node.attrs.alt as string);
  if (!caption) {
    const style = imageStyleString(width, height, align, objectFit);
    return `<img src="${src}" alt="${alt}"${style ? ` style="${escapeAttr(style)}"` : ""}>`;
  }
  const imgStyle = imageSizeAndFitStyleString(width, height, objectFit);
  const alignStyle = imageAlignStyleString(align);
  const figureStyle = alignStyle ? `margin:0;${alignStyle}` : "margin:0";
  const img = `<img src="${src}" alt="${alt}"${imgStyle ? ` style="${escapeAttr(imgStyle)}"` : ""}>`;
  return `<figure style="${escapeAttr(figureStyle)}">${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
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
        inner += imageChildHtml(child);
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

/** The image node attrs a bare `<img>` carries - shared by every import
 * path that reaches one (`walkInlineHtml`, `importCleanHtml`'s top-level
 * case, and `imageNodeFromFigure` below for the `<img>` nested inside a
 * `<figure>`). `caption` is deliberately absent here - a bare `<img>` never
 * carries one; only `imageNodeFromFigure` sets it. */
function imageAttrsFromElement(img: HTMLImageElement): Record<string, unknown> {
  return {
    src: img.getAttribute("src") ?? "",
    alt: img.getAttribute("alt") ?? "",
    ...imageSizeFromElement(img),
    align: parseImageAlign(img),
    objectFit: imageObjectFitFromElement(img),
  };
}

/** Reads a captioned image back from `<figure><img>...<figcaption>...
 * </figcaption></figure>` - the inverse of `imageChildHtml`'s own
 * `figureWrap`-equivalent above. `null` for a figure with no `<img>`
 * inside (nothing this schema can represent), so callers fall back to
 * treating it as an ordinary unrecognized wrapper instead of losing it. */
function imageNodeFromFigure(figure: Element): PMNode | null {
  const img = figure.querySelector("img");
  if (!img) return null;
  const caption = figure.querySelector("figcaption")?.textContent ?? "";
  return schema.nodes.image!.create({ ...imageAttrsFromElement(img), caption });
}

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
    return [schema.nodes.image!.create(imageAttrsFromElement(domNode as HTMLImageElement))];
  }
  if (domNode.nodeName === "FIGURE") {
    const node = imageNodeFromFigure(domNode as Element);
    if (node) return [node];
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
    // synthesize the paragraph it'd otherwise have lived in. A top-level
    // `<figure>` (this field's own export of a captioned image alone in
    // its paragraph - see `imageChildHtml`) gets the same treatment.
    if (block.tagName === "IMG") {
      blockNodes.push(
        schema.nodes.paragraph!.create(null, schema.nodes.image!.create(imageAttrsFromElement(block as HTMLImageElement))),
      );
      continue;
    }
    if (block.tagName === "FIGURE") {
      const imageNode = imageNodeFromFigure(block);
      if (imageNode) {
        blockNodes.push(schema.nodes.paragraph!.create(null, imageNode));
        continue;
      }
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
