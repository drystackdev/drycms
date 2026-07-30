import type { Node as PMNode, NodeType } from "prosemirror-model";
import {
  blockNodeTypeAndAttrs,
  blockTypeFromTagName,
  blockTypeOfNode,
  captionFromElement,
  cellHAlignFromElement,
  cellHAlignStyle,
  cellVAlignFromElement,
  cellVAlignStyle,
  colgroupHtml,
  colSpanFromStyle,
  colWidthsFromElement,
  dryInlineAttrsFromElement,
  dryInlineStyleString,
  gridColumnsFromStyle,
  gridContainerStyleString,
  gridItemStyleString,
  heightPxFromStyle,
  imageAlignStyleString,
  imageObjectFitFromElement,
  imageSizeAndFitStyleString,
  imageSizeFromElement,
  imageStyleString,
  parseImageAlign,
  rowHeightStyleString,
  rowSpanFromStyle,
  schema,
  type CellHAlign,
  type CellVAlign,
  type ImageAlign,
  type ImageObjectFit,
} from "./schema.js";
import { normalizeTextAlign, type BlockType } from "./types.js";

/**
 * RichTextField's own HTML <-> ProseMirror doc conversion (rewritten from
 * the Lexical version of this file, same file name/shape). Only the marks
 * this field's toolbar can produce need to survive the trip: `<strong>`,
 * `<em>`, `<u>`, a `<span style="color: ...">` (see color-menu.tsx), `<br>`,
 * an inline `<img>` (see schema.ts), plain text, and a block element per
 * top-level element - either a flat textblock (`<p>`, `<h2>`-`<h6>`,
 * `<blockquote>`) or one that itself nests further blocks (`<ul>`/`<ol>`
 * of `<li>`s, `<table>` of `<tr>`s of `<td>`/`<th>`s - see `blockTag`'s
 * siblings below for the recursive walk both directions).
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
  const linkMark = schema.marks.link!.isInSet(node.marks);
  if (linkMark) {
    const target = linkMark.attrs.target as string | null;
    const href = escapeAttr(linkMark.attrs.href as string);
    text = `<a href="${href}"${target ? ` target="${escapeAttr(target)}" rel="noopener noreferrer"` : ""}>${text}</a>`;
  }
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
 * dropping the caption instead would actively lose user content.
 *
 * `display:table` on the figure (rather than the UA default `block`, which
 * stretches to the paragraph's full width) shrink-wraps it to the `<img>` -
 * its only other child, auto-boxed into the table's row/cell - so the
 * `<figcaption>` (given `display:table-caption`, the one display value
 * whose box is forced to exactly the table's own width) centers under the
 * image and word-wraps once its text outgrows it, instead of overflowing
 * or stretching the figure wider than the image. `caption-side:bottom`
 * is required alongside it - a table-caption box always renders at its
 * specified side regardless of DOM order, and the default is `top`. */
function imageChildHtml(node: PMNode): string {
  const width = node.attrs.width as number | null;
  const height = node.attrs.height as number | null;
  const align = node.attrs.align as ImageAlign | null;
  // Locked means the box is always in the image's own natural ratio, so
  // object-fit can't have any visible effect - omit it (see
  // `imageSizeAndFitStyleString`'s own doc comment in schema.ts).
  const objectFit = node.attrs.lockAspectRatio ? null : (node.attrs.objectFit as ImageObjectFit);
  const caption = node.attrs.caption as string;
  const src = escapeAttr(node.attrs.src as string);
  const alt = escapeAttr(node.attrs.alt as string);
  if (!caption) {
    const style = imageStyleString(width, height, align, objectFit);
    return `<img src="${src}" alt="${alt}"${style ? ` style="${escapeAttr(style)}"` : ""}>`;
  }
  const imgStyle = imageSizeAndFitStyleString(width, height, objectFit);
  const alignStyle = imageAlignStyleString(align);
  const figureStyle = ["margin:0", "display:table", alignStyle].filter(Boolean).join(";");
  const captionStyle = "display:table-caption;caption-side:bottom;text-align:center";
  const img = `<img src="${src}" alt="${alt}"${imgStyle ? ` style="${escapeAttr(imgStyle)}"` : ""}>`;
  return `<figure style="${escapeAttr(figureStyle)}">${img}<figcaption style="${escapeAttr(captionStyle)}">${escapeHtml(caption)}</figcaption></figure>`;
}

/** Export half of a registered richtext component node (mục 6,
 * `status/register-compoennt.md`) - always an explicit open+close tag pair,
 * never self-closed (`<dry-x/>`): custom elements aren't in HTML5's void-
 * element list, so a browser parsing this back as real HTML ignores a
 * trailing `/` and keeps the element open, swallowing everything after it
 * as children until an explicit `</dry-x>` (or, if none ever comes,
 * corrupting the rest of the document). Works for both `inline` and
 * `block` types - same tag shape either way, only where it's called from
 * differs (`inlineChildrenHtml` vs `exportBlockHtml`).
 *
 * A `children: true` component (`node.type.spec.content` set, see
 * `schema.ts`'s own `buildDryNodeSpecs`) writes its real `block+` content
 * between the tags instead of leaving them empty - the light-DOM children a
 * browser projects into the component's own `<slot />` (`dry-component-
 * view.ts`), same idea as `exportGridHtml` writing a grid's own children. */
function dryComponentHtml(node: PMNode): string {
  const tag = `dry-${node.type.name.slice("dry_".length)}`;
  const attrs: Record<string, string> = { props: escapeAttr(JSON.stringify(node.attrs.props)) };
  if (node.type.isInline) {
    const style = dryInlineStyleString(
      node.attrs.width as number | null,
      node.attrs.height as number | null,
      node.attrs.align as ImageAlign | null,
    );
    if (style) attrs.style = escapeAttr(style);
  }
  const attrString = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join("");
  const inner = node.type.spec.content ? blockChildrenHtml(node) : "";
  return `<${tag}${attrString}>${inner}</${tag}>`;
}

/** `null` for any tag that isn't `dry-*`, or one that is but has no
 * matching confirmed component in the *current* `schema` (an unconfirmed/
 * removed component's markup left over in saved content) - callers fall
 * back to treating it as unrecognized, same as any other foreign tag. */
function dryComponentNodeType(tagName: string): NodeType | null {
  if (!tagName.startsWith("DRY-")) return null;
  return schema.nodes[`dry_${tagName.slice("DRY-".length).toLowerCase()}`] ?? null;
}

/** Inverse of `dryComponentHtml` above - a `children: true` type reads its
 * own element's children back via `blockChildrenFromContainer` (the same
 * walk a `<li>`/table cell's content uses), which already synthesizes a
 * lone empty paragraph for a childless/self-closed `<dry-x>` left over from
 * before this node type had content, satisfying `content: "block+"`'s own
 * minimum-one requirement without a separate empty-check here. */
function dryComponentNodeFromElement(el: Element, type: NodeType): PMNode {
  let props: unknown = {};
  try {
    props = JSON.parse(el.getAttribute("props") ?? "{}");
  } catch {
    props = {};
  }
  const attrs = type.isInline ? { props, ...dryInlineAttrsFromElement(el as HTMLElement) } : { props };
  if (type.spec.content) return type.create(attrs, blockChildrenFromContainer(el));
  return type.create(attrs);
}

/** A flat textblock's (paragraph/heading/blockquote) own inline content -
 * shared by `exportBlockHtml` for however many places one can occur
 * (top level, a list item, a table cell). */
function inlineChildrenHtml(node: PMNode): string {
  let inner = "";
  node.forEach((child) => {
    if (child.type === schema.nodes.image) {
      inner += imageChildHtml(child);
    } else if (child.type === schema.nodes.hard_break) {
      inner += "<br>";
    } else if (child.type.name.startsWith("dry_")) {
      inner += dryComponentHtml(child);
    } else if (child.isText) {
      inner += textNodeToHtml(child);
    }
  });
  return inner;
}

/** A block node's own `block+` children, each recursively exported and
 * concatenated - `list_item`'s and a table cell's own content, both of
 * which can themselves hold another list/table/textblock. */
function blockChildrenHtml(node: PMNode): string {
  let inner = "";
  node.forEach((child) => {
    inner += exportBlockHtml(child);
  });
  return inner;
}

/** A `list_item`/table cell's own content, unwrapped straight into the
 * parent tag (`<li>text</li>`, `<td>text</td>`) when it's exactly the one
 * plain (unaligned) paragraph a bare `<li>`/`<td>` round-trips to - matching
 * how hand-written HTML normally writes a simple item/cell, same "only the
 * non-default case needs an explicit wrapper" spirit as `ordered_list`'s own
 * `start` attr or `imageChildHtml`'s figure/no-figure split above. Anything
 * more (a second block, a nested list/table, a lone *aligned* paragraph)
 * still gets its full `blockChildrenHtml` treatment - unwrapping only the
 * single-plain-paragraph case is the one this schema's own import
 * (`blockChildrenFromContainer`'s synthesized-paragraph fallback) always
 * produces from that bare form, so the two stay inverses of each other. */
function containerContentHtml(node: PMNode): string {
  const only = node.childCount === 1 ? node.firstChild! : null;
  if (only && only.type === schema.nodes.paragraph && ((only.attrs.textAlign as string | null) ?? "left") === "left") {
    return inlineChildrenHtml(only);
  }
  return blockChildrenHtml(node);
}

function listItemsHtml(listNode: PMNode): string {
  let inner = "";
  listNode.forEach((item) => {
    inner += `<li>${containerContentHtml(item)}</li>`;
  });
  return inner;
}

/** `colspan`/`rowspan` attributes for a cell produced by merging (see
 * `table.ts`'s `unmergeCell`/`prosemirror-tables`' own `mergeCells`) - only
 * written when greater than the default 1, matching this file's usual "only
 * the non-default case needs an explicit attribute" convention. */
function cellSpanAttrString(cell: PMNode): string {
  const colspan = cell.attrs.colspan as number;
  const rowspan = cell.attrs.rowspan as number;
  return `${colspan > 1 ? ` colspan="${colspan}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}`;
}

/** `text-align`/`vertical-align` style fragment for a cell's own
 * `hAlign`/`vAlign` attrs (`table-cell-align-button.tsx`) - only the
 * non-default half of each ever contributes anything, matching every other
 * "only the non-default case needs an explicit style" spot in this file. */
function cellAlignStyleString(cell: PMNode): string {
  return cellHAlignStyle(cell.attrs.hAlign as CellHAlign | null) + cellVAlignStyle(cell.attrs.vAlign as CellVAlign | null);
}

function tableRowsHtml(tableNode: PMNode): string {
  let inner = "";
  tableNode.forEach((row) => {
    const style = rowHeightStyleString(row.attrs.heightPx as number | null);
    inner += `<tr${style ? ` style="${escapeAttr(style)}"` : ""}>`;
    row.forEach((cell) => {
      const tag = cell.type === schema.nodes.table_header ? "th" : "td";
      const style = cellAlignStyleString(cell);
      inner += `<${tag}${cellSpanAttrString(cell)}${style ? ` style="${escapeAttr(style)}"` : ""}>${containerContentHtml(cell)}</${tag}>`;
    });
    inner += "</tr>";
  });
  return inner;
}

function styleAttr(style: string | undefined): string {
  return style ? ` style="${escapeAttr(style)}"` : "";
}

/** The one fixed (not per-instance) `<style>` block every exported grid
 * carries: a default full-width/single-row rule for whichever items DON'T
 * get their own inline `grid-column`/`grid-row` (see `exportGridHtml`
 * below - only non-default items do, matching this file's usual "only the
 * non-default case needs an explicit style" convention, which an inline
 * style alone can't do here without this default rule backing it - an
 * unset `grid-column` is `span 1`, not "full width", the exact bug that bit
 * this feature's first, reverted attempt), plus a `!important` mobile
 * override collapsing every item back to that same default regardless of
 * its own inline span. `!important` is required there specifically because
 * it has to beat an *inline* style, which normal specificity never can -
 * every other rule in this file only ever competes with other stylesheet
 * rules. Repeated verbatim in every grid's own export (rather than hoisted
 * once per document) so a single grid `<div>` copied out on its own still
 * renders correctly standalone - same self-contained reasoning as every
 * other style in this file. `columns` is the specific grid's own column
 * count (`grid.attrs.columns`, see `schema.ts`) - not a fixed constant,
 * since each grid instance can carry a different one (`grid-menu.tsx`'s
 * columns selector). */
function gridStyleTag(columns: number): string {
  const defaultStyle = gridItemStyleString(columns, 1);
  const mobileStyle = `grid-column:span ${columns} !important;grid-row:span 1 !important`;
  return `<style>.dry-tx-grid>*{${defaultStyle}}@media (width < 48rem){.dry-tx-grid>*{${mobileStyle}}}</style>`;
}

/** A grid's own export: each `grid_item`'s single inner block, unwrapped
 * (no per-item wrapper element - the inverse of `importGridElement` below),
 * carrying its own `colSpan`/`rowSpan` as a plain inline `style` on
 * whatever tag that block itself exports as - but only when it differs
 * from the all-default span `gridStyleTag`'s own default rule already
 * covers; the default case gets no inline style at all. */
function exportGridHtml(gridNode: PMNode, extraStyle?: string): string {
  const columns = gridNode.attrs.columns as number;
  const containerStyle = [gridContainerStyleString(columns), extraStyle].filter(Boolean).join(";");
  let childrenHtml = "";
  gridNode.forEach((item) => {
    if (!item.firstChild) return;
    const colSpan = item.attrs.colSpan as number;
    const rowSpan = item.attrs.rowSpan as number;
    const itemStyle = colSpan !== columns || rowSpan !== 1 ? gridItemStyleString(colSpan, rowSpan) : undefined;
    childrenHtml += exportBlockHtml(item.firstChild, itemStyle);
  });
  return `<div class="dry-tx-grid"${styleAttr(containerStyle)}>${gridStyleTag(columns)}${childrenHtml}</div>`;
}

/** Exports one block-level node - dispatches to `<ul>`/`<ol>` or `<table>`
 * for the 2 node types that themselves nest further blocks, or the flat
 * `<p>`/`<h2>`-`<h6>`/`<blockquote>` case (`blockTypeOfNode`'s own domain)
 * for everything else. Used both for the doc's own top-level children and,
 * recursively, for whatever sits inside a `list_item` or table cell.
 * `extraStyle` is only ever passed by `exportGridHtml` above, to merge a
 * grid item's own span onto whichever tag this produces - every other
 * caller leaves it unset. */
function exportBlockHtml(node: PMNode, extraStyle?: string): string {
  if (node.type.name.startsWith("dry_")) {
    return dryComponentHtml(node);
  }
  if (node.type === schema.nodes.bullet_list) {
    return `<ul${styleAttr(extraStyle)}>${listItemsHtml(node)}</ul>`;
  }
  if (node.type === schema.nodes.ordered_list) {
    const start = node.attrs.start as number;
    return `<ol${start !== 1 ? ` start="${start}"` : ""}${styleAttr(extraStyle)}>${listItemsHtml(node)}</ol>`;
  }
  if (node.type === schema.nodes.table) {
    const caption = node.attrs.caption as string;
    const captionHtml = caption ? `<caption>${escapeHtml(caption)}</caption>` : "";
    return `<table${styleAttr(extraStyle)}>${captionHtml}${colgroupHtml(node.attrs.colWidths as number[] | null)}<tbody>${tableRowsHtml(node)}</tbody></table>`;
  }
  if (node.type === schema.nodes.grid) {
    return exportGridHtml(node, extraStyle);
  }
  const tag = blockTag(blockTypeOfNode(node));
  const align = (node.attrs.textAlign as string | null) ?? "left";
  const alignStyle = align === "left" ? "" : `text-align: ${align}`;
  const style = [alignStyle, extraStyle].filter(Boolean).join(";");
  return `<${tag}${styleAttr(style)}>${inlineChildrenHtml(node)}</${tag}>`;
}

export function exportCleanHtml(doc: PMNode): string {
  let out = "";
  doc.forEach((node) => {
    out += exportBlockHtml(node);
  });
  return out;
}

interface InlineAncestry {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** CSS `color` value, or `""` for none - a nested element's own `color`
   * replaces rather than combines with the ancestor's. */
  color: string;
  /** Nearest ancestor `<a href>`'s own `href`/`target`, or `""`/`null` for
   * none - like `color` above, a nested `<a>` would replace rather than
   * combine with an ancestor's (this schema's `link` mark isn't recursive
   * either way, so nested anchors are a non-issue in practice). */
  href: string;
  target: string | null;
}

const NO_MARKS: InlineAncestry = { bold: false, italic: false, underline: false, color: "", href: "", target: null };

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
    if (ancestry.href) marks.push(schema.marks.link!.create({ href: ancestry.href, target: ancestry.target }));
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
  const inlineDryType = dryComponentNodeType(domNode.nodeName);
  if (inlineDryType?.isInline) return [dryComponentNodeFromElement(domNode as Element, inlineDryType)];
  if (domNode.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = domNode.nodeName;
  const isAnchor = tag === "A" && domNode instanceof HTMLElement && domNode.hasAttribute("href");
  const nextAncestry: InlineAncestry = {
    bold: ancestry.bold || tag === "STRONG" || tag === "B",
    italic: ancestry.italic || tag === "EM" || tag === "I",
    underline: ancestry.underline || tag === "U",
    color: (domNode instanceof HTMLElement && domNode.style.color) || ancestry.color,
    href: isAnchor ? ((domNode as HTMLElement).getAttribute("href") ?? "") : ancestry.href,
    target: isAnchor ? (domNode as HTMLElement).getAttribute("target") : ancestry.target,
  };
  return Array.from(domNode.childNodes).flatMap((child) => walkInlineHtml(child, nextAncestry));
}

const BLOCK_TAGS = new Set(["P", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "TABLE"]);

/** Inverse of `cellSpanAttrString` in the export half above - `1` (the
 * schema default) for anything absent, non-numeric, or less than 1. */
function cellSpanFromElement(el: Element, attr: "colspan" | "rowspan"): number {
  const value = Number(el.getAttribute(attr));
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** A flat textblock element (`<p>`/`<h2>`-`<h6>`/`<blockquote>`) - the
 * import-side counterpart of `exportBlockHtml`'s own fallback case. */
function importTextblockElement(el: Element): PMNode {
  const { type, attrs } = blockNodeTypeAndAttrs(blockTypeFromTagName(el.tagName));
  const align = normalizeTextAlign(el instanceof HTMLElement ? el.style.textAlign : undefined);
  const finalAttrs = align !== "left" ? { ...(attrs ?? {}), textAlign: align } : attrs;
  const inlineNodes = Array.from(el.childNodes).flatMap((child) => walkInlineHtml(child, NO_MARKS));
  return type.create(finalAttrs, inlineNodes);
}

function importListElement(el: Element, ordered: boolean): PMNode {
  const items = Array.from(el.children)
    .filter((child) => child.tagName === "LI")
    .map((li) => schema.nodes.list_item!.create(null, blockChildrenFromContainer(li)));
  if (items.length === 0) items.push(schema.nodes.list_item!.create(null, [schema.nodes.paragraph!.create()]));
  if (!ordered) return schema.nodes.bullet_list!.create(null, items);
  const startAttr = Number(el.getAttribute("start"));
  return schema.nodes.ordered_list!.create({ start: Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1 }, items);
}

function importTableElement(el: Element): PMNode {
  const rowEls = Array.from(el.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr"));
  const rows: PMNode[] = [];
  for (const rowEl of rowEls) {
    const cells = Array.from(rowEl.children)
      .filter((cellEl) => cellEl.tagName === "TD" || cellEl.tagName === "TH")
      .map((cellEl) => {
        const cellType = cellEl.tagName === "TH" ? schema.nodes.table_header! : schema.nodes.table_cell!;
        const attrs = {
          colspan: cellSpanFromElement(cellEl, "colspan"),
          rowspan: cellSpanFromElement(cellEl, "rowspan"),
          hAlign: cellEl instanceof HTMLElement ? cellHAlignFromElement(cellEl) : null,
          vAlign: cellEl instanceof HTMLElement ? cellVAlignFromElement(cellEl) : null,
        };
        return cellType.create(attrs, blockChildrenFromContainer(cellEl));
      });
    if (cells.length === 0) continue;
    const heightPx = rowEl instanceof HTMLElement ? heightPxFromStyle(rowEl.style.cssText) : null;
    rows.push(schema.nodes.table_row!.create({ heightPx }, cells));
  }
  if (rows.length === 0) rows.push(schema.nodes.table_row!.create(null, [schema.nodes.table_cell!.createAndFill()!]));
  return schema.nodes.table!.create({ caption: captionFromElement(el), colWidths: colWidthsFromElement(el) }, rows);
}

/** Whether `el` is this field's own grid wrapper - checked by class rather
 * than a fixed tag+attribute combo (unlike `BLOCK_TAGS`'s plain tag-name
 * lookup) since a `<div>` on its own is otherwise meaningless to this
 * schema; any other `<div>` (from hand-written or foreign HTML) falls
 * through to the same "unrecognized wrapper" handling every other stray
 * element already gets in `blockChildrenFromContainer`. */
function isGridElement(el: Element): boolean {
  return el.tagName === "DIV" && el.classList.contains("dry-tx-grid");
}
/** Matches one of `gridStyleTag`'s own generated `nth-child` rules,
 * regardless of the (per-export-random) class prefix in front of it - e.g.
 * `.g3f8k2>:nth-child(2){grid-column:span 6;grid-row:span 2}`. Only ever
 * run against a `<style>` element this same field generated (see
 * `importGridElement` below), so a foreign/hand-written `<div>` never gets
 * misread as one. */

/** Reads a grid back from `<div class="dry-tx-grid">`'s own children - the
 * inverse of `exportGridHtml` above. Every non-`<style>` child is read as
 * one item's sole block (`importBlockElement`, the same per-element
 * dispatch a doc's own top-level children get - a grid item is never a
 * wrapper element in this format, just the block itself), with its
 * `colSpan`/`rowSpan` read directly off that same element's own inline
 * `style` (`colSpanFromStyle`/`rowSpanFromStyle`, schema.ts) - already
 * defaulting to the all-default span when there's no `grid-column`/
 * `grid-row` in it at all, matching `exportGridHtml`'s own "no inline style
 * for the default case" convention. */
function importGridElement(el: Element): PMNode {
  const columns = gridColumnsFromStyle(el instanceof HTMLElement ? el.style.cssText : "");
  const items = Array.from(el.children)
    .filter((child) => child.tagName !== "STYLE")
    .map((childEl) => {
      const style = childEl instanceof HTMLElement ? childEl.style.cssText : "";
      const attrs = { colSpan: colSpanFromStyle(style, columns), rowSpan: rowSpanFromStyle(style) };
      return schema.nodes.grid_item!.create(attrs, importBlockElement(childEl));
    });
  if (items.length === 0) {
    items.push(schema.nodes.grid_item!.create({ colSpan: columns, rowSpan: 1 }, schema.nodes.paragraph!.create()));
  }
  return schema.nodes.grid!.create({ columns }, items);
}

/** One top-level-shaped block element - dispatches to a list/table/grid
 * (each recursing back into `blockChildrenFromContainer` for their own
 * nested content) or a flat textblock otherwise. */
function importBlockElement(el: Element): PMNode {
  if (el.tagName === "UL") return importListElement(el, false);
  if (el.tagName === "OL") return importListElement(el, true);
  if (el.tagName === "TABLE") return importTableElement(el);
  if (isGridElement(el)) return importGridElement(el);
  return importTextblockElement(el);
}

/** Reads a container's `childNodes` into a list of block nodes - the shared
 * walk behind the doc's own top level, a `<li>`'s content, and a `<td>`/
 * `<th>`'s content. Any of `BLOCK_TAGS` (or a captioned `<figure>`) becomes
 * its own block; a bare `<figure>` with no `<img>` inside, and any other
 * run of non-block content (plain text, `<img>`, `<strong>`, ...) in
 * between, gets synthesized into a paragraph - same fallback
 * `importCleanHtml` always gave a stray top-level `<img>`, now extended to
 * everywhere else block content can nest, and to a run of *several* such
 * siblings at once (`<td>A <b>bold</b> B</td>`, unlike the old top-level-
 * only walk, which only ever looked at `.children`, i.e. one element at a
 * time - dropping any bare text node sitting between two of them). */
function blockChildrenFromContainer(container: Element): PMNode[] {
  const blocks: PMNode[] = [];
  let inlineBuffer: ChildNode[] = [];
  const flushInline = () => {
    if (inlineBuffer.length === 0) return;
    const inlineNodes = inlineBuffer.flatMap((child) => walkInlineHtml(child, NO_MARKS));
    blocks.push(schema.nodes.paragraph!.create(null, inlineNodes));
    inlineBuffer = [];
  };
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      inlineBuffer.push(child);
      continue;
    }
    const el = child as Element;
    const blockDryType = dryComponentNodeType(el.tagName);
    if (blockDryType && !blockDryType.isInline) {
      flushInline();
      blocks.push(dryComponentNodeFromElement(el, blockDryType));
      continue;
    }
    if (BLOCK_TAGS.has(el.tagName) || isGridElement(el)) {
      flushInline();
      blocks.push(importBlockElement(el));
      continue;
    }
    if (el.tagName === "FIGURE") {
      flushInline();
      const imageNode = imageNodeFromFigure(el);
      blocks.push(
        imageNode
          ? schema.nodes.paragraph!.create(null, imageNode)
          : schema.nodes.paragraph!.create(null, Array.from(el.childNodes).flatMap((c) => walkInlineHtml(c, NO_MARKS))),
      );
      continue;
    }
    inlineBuffer.push(child);
  }
  flushInline();
  if (blocks.length === 0) blocks.push(schema.nodes.paragraph!.create());
  return blocks;
}

/** Accepts this field's own clean export, or any simple hand-written HTML
 * using the same handful of tags - unrecognized wrapper elements are just
 * unwrapped rather than rejected. */
export function importCleanHtml(html: string): PMNode {
  const dom = new DOMParser().parseFromString(html, "text/html");
  return schema.nodes.doc!.create(null, blockChildrenFromContainer(dom.body));
}
