import { Schema, type Attrs, type DOMOutputSpec, type Node as PMNode, type NodeType } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";
import type { BlockType, TextAlign } from "./types.js";

/**
 * ProseMirror schema for this field - deliberately small, matching exactly
 * what the toolbar (`toolbar-buttons.ts`) can produce: paragraph/heading
 * (h2-h6)/blockquote blocks, bold/italic/underline/textColor marks, an
 * inline image, and `<br>`. Not a port of drystack's `schema.tsx` (which
 * also carries tables, grids, svg, content-refs, lists, links, code, font
 * size...) - this field's own contract is HTML in/out, so it only needs the
 * handful of tags `html.ts` round-trips.
 */

const HEADING_LEVELS = [2, 3, 4, 5, 6] as const;

const TEXT_ALIGN_VALUES = new Set<TextAlign>(["left", "center", "right", "justify"]);

function getTextAlignAttrs(dom: HTMLElement | string): { textAlign: TextAlign | null } {
  if (typeof dom === "string") return { textAlign: null };
  const textAlign = dom.style.textAlign;
  return { textAlign: TEXT_ALIGN_VALUES.has(textAlign as TextAlign) ? (textAlign as TextAlign) : null };
}

/** Only non-default ("left") alignment needs to survive as an explicit
 * style - mirrors `$exportCleanHtml`'s old behavior. */
function withTextAlign(attrs: Record<string, string>, textAlign: string | null): Record<string, string> {
  if (!textAlign || textAlign === "left") return attrs;
  return { ...attrs, style: `text-align: ${textAlign}` };
}

function parseImageSize(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Reads an explicit width/height back off an `<img>` - inline `style`
 * first, then the `width`/`height` attributes, matching `imageStyleString`
 * below. Shared by this schema's own `parseDOM` and `html.ts`'s manual
 * import walk (which doesn't go through `parseDOM` at all). */
export function imageSizeFromElement(el: HTMLElement): { width: number | null; height: number | null } {
  return {
    width: parseImageSize(el.style.width) ?? parseImageSize(el.getAttribute("width")),
    height: parseImageSize(el.style.height) ?? parseImageSize(el.getAttribute("height")),
  };
}

/** The 3 `object-fit` choices `image-menu.tsx`'s edit dialog offers -
 * replaces what used to be this field's own hardcoded, unconditional
 * `object-fit: contain` whenever an image had an explicit width or height.
 * "Full" in the dialog's own label maps to CSS `fill` (stretches to the
 * given box, distorting the ratio if it doesn't match). */
export type ImageObjectFit = "fill" | "cover" | "contain";

const IMAGE_OBJECT_FIT_VALUES = new Set<ImageObjectFit>(["fill", "cover", "contain"]);

/** Reads an image's `object-fit` back off its inline style - unrecognized
 * or absent (an image sized before this attr existed) falls back to
 * "contain", this field's original hardcoded behavior. */
export function imageObjectFitFromElement(el: HTMLElement): ImageObjectFit {
  const value = el.style.objectFit;
  return IMAGE_OBJECT_FIT_VALUES.has(value as ImageObjectFit) ? (value as ImageObjectFit) : "contain";
}

/** The 3 float/center layouts `image-menu.tsx`'s align buttons offer -
 * `null` (the default) leaves the image flowing inline with surrounding
 * text, same as before this attr existed. Ported from drystack's
 * `ImageAlign`, minus its own `null` already meaning the same thing there. */
export type ImageAlign = "left" | "center" | "right";

/** Inverse of `imageAlignStyleString` below - reads which layout (if any)
 * an `<img>`'s inline style currently encodes. `min-width: 100%` only ever
 * comes from the "center" encoding here (a plain unaligned image never sets
 * it), so it's an unambiguous marker even without checking `margin-inline`. */
export function parseImageAlign(el: HTMLElement): ImageAlign | null {
  if (el.style.float === "left" || el.style.float === "right") return el.style.float;
  if (el.style.minWidth === "100%") return "center";
  return null;
}

/** The inline `style` for an image's align attr - `left`/`right` float it
 * (matching drystack's own `imageContainerAlignStyle`, physical rather than
 * logical directions since `float` itself already is), `center` stretches it
 * to the paragraph's full width via `min-width: 100%` (an `<img>` is a
 * replaced element, so `min-width` takes effect regardless of its default
 * inline display - no `display: block` needed) - `margin-inline: auto` is a
 * no-op once the image already fills the line, kept only for parity with
 * `image-view.ts`'s own wrapper-based centering. */
export function imageAlignStyleString(align: ImageAlign | null): string {
  if (align === "left") return "float:left;margin-inline-end:1em;margin-block:0.5em";
  if (align === "right") return "float:right;margin-inline-start:1em;margin-block:0.5em";
  if (align === "center") return "min-width:100%;margin-inline:auto";
  return "";
}

/** The inline `style` for an image's explicit size (set via the resize
 * handles - see `image-view.ts`) and `object-fit` (`image-menu.tsx`'s edit
 * dialog) - `max-width`/`max-height: none` override this field's own
 * default cap on an unsized image (`.dry-tx-image` in content-shadow-styles.ts), which
 * would otherwise clamp a deliberately-resized-larger image right back
 * down. Split out from `imageStyleString` below so a captioned image
 * (`exportCleanHtml`'s `<figure>` case) can put size/fit on the `<img>`
 * itself and align on the `<figure>` wrapping it, instead of both landing
 * on the same element the way the uncaptioned case does.
 *
 * `objectFit: null` (callers pass this whenever `node.attrs.lockAspectRatio`
 * is true) omits the declaration entirely rather than writing it out anyway:
 * a locked image's box is always in its own natural ratio, so `fill`/`cover`/
 * `contain` render identically either way - there's nothing for the attr to
 * *do* until the box can actually differ from that ratio (i.e. unlocked). */
export function imageSizeAndFitStyleString(
  width: number | null,
  height: number | null,
  objectFit: ImageObjectFit | null,
): string {
  const parts: string[] = [];
  if (width != null) parts.push(`width:${width}px`, "max-width:none");
  if (height != null) parts.push(`height:${height}px`, "max-height:none");
  if (objectFit && (width != null || height != null)) parts.push(`object-fit:${objectFit}`);
  return parts.join(";");
}

/** `imageSizeAndFitStyleString` + `imageAlignStyleString` combined onto one
 * element - this field's own uncaptioned `<img>` (both this schema's own
 * `toDOM` and `exportCleanHtml`'s bare-image case) has no wrapper to split
 * them across, unlike the captioned `<figure>` case. */
export function imageStyleString(
  width: number | null,
  height: number | null,
  align: ImageAlign | null,
  objectFit: ImageObjectFit | null,
): string {
  return [imageSizeAndFitStyleString(width, height, objectFit), imageAlignStyleString(align)].filter(Boolean).join(";");
}

const olDOM: DOMOutputSpec = ["ol", 0];
const ulDOM: DOMOutputSpec = ["ul", 0];
const liDOM: DOMOutputSpec = ["li", 0];

/** Reads a `<tr>`'s own resized height back off its inline `style` - shared
 * by this schema's `table_row.parseDOM` and `html.ts`'s import walk (which,
 * like the image node, doesn't go through `parseDOM` for tables either -
 * see `table.ts`'s own doc comment for why). */
export function heightPxFromStyle(style: string): number | null {
  const match = /(?:^|;)\s*height\s*:\s*([\d.]+)px/.exec(style);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getRowHeightAttrs(dom: HTMLElement | string): { heightPx: number | null } {
  if (typeof dom === "string") return { heightPx: null };
  return { heightPx: heightPxFromStyle(dom.style.cssText) };
}

/** The inline `style` for a resized row - shared by this schema's
 * `table_row.toDOM` and `html.ts`'s export. */
export function rowHeightStyleString(heightPx: number | null): string {
  return heightPx != null ? `height:${heightPx}px` : "";
}

/** Reads a `<table>`'s own `<caption>` text back - shared by this schema's
 * `table.parseDOM` and `html.ts`'s import walk (which, like the row/image
 * nodes, doesn't go through `parseDOM` for tables either - see that file's
 * own doc comment). The only other caption-shaped element in this schema is
 * a captioned image's `<figcaption>` (`imageNodeFromFigure` in `html.ts`). */
export function captionFromElement(dom: Element | string): string {
  if (typeof dom === "string") return "";
  return dom.querySelector(":scope > caption")?.textContent ?? "";
}

const COL_WIDTH_PERCENT = /(?:^|;)\s*width\s*:\s*([\d.]+)%/;

/** Reads a `<table>`'s own `<colgroup><col style="width:N%"></colgroup>`
 * back into per-column integer percentages - `null` (meaning "no explicit
 * widths, split evenly") if there's no colgroup, or any `<col>` is missing a
 * parseable percent width. Shared by this schema's `table.parseDOM` and
 * `html.ts`'s import walk. */
export function colWidthsFromElement(dom: Element | string): number[] | null {
  if (typeof dom === "string") return null;
  const cols = Array.from(dom.querySelectorAll(":scope > colgroup > col"));
  if (cols.length === 0) return null;
  const widths = cols.map((col) => {
    const match = COL_WIDTH_PERCENT.exec((col as HTMLElement).style.cssText);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? Math.round(value) : null;
  });
  return widths.every((width): width is number => width != null) ? (widths as number[]) : null;
}

function getTableAttrs(dom: HTMLElement | string): { caption: string; colWidths: number[] | null } {
  return { caption: captionFromElement(dom), colWidths: colWidthsFromElement(dom) };
}

/** `<colgroup>` `DOMOutputSpec` built from `colWidths` - shared by this
 * node's own `toDOM` below and `html.ts`'s manual export (`colgroupHtml`).
 * `null` (the "split evenly" default) omits the colgroup entirely -
 * `table-layout: fixed` (content-shadow-styles.ts) already splits unset columns
 * evenly, matching this field's previous (pre-resize) behavior. */
export function colgroupDOMSpec(colWidths: number[] | null): DOMOutputSpec | null {
  if (!colWidths || colWidths.length === 0) return null;
  return ["colgroup", ...colWidths.map((width): DOMOutputSpec => ["col", { style: `width:${width}%` }])];
}

/** `html.ts`'s own export-side equivalent of `colgroupDOMSpec` above (that
 * file builds HTML strings directly rather than going through this schema's
 * `toDOM`/`DOMSerializer` - see its own doc comment). */
export function colgroupHtml(colWidths: number[] | null): string {
  if (!colWidths || colWidths.length === 0) return "";
  return `<colgroup>${colWidths.map((width) => `<col style="width:${width}%">`).join("")}</colgroup>`;
}

/** The 2 axes `table-cell-align-button.tsx`'s 3x3 grid picks from - kept as
 * separate attrs (rather than one combined 9-value string) since a cell's
 * `text-align`/`vertical-align` are independent CSS properties. */
export type CellHAlign = "left" | "center" | "right";
export type CellVAlign = "top" | "middle" | "bottom";

const CELL_H_ALIGN_VALUES = new Set<string>(["left", "center", "right"]);
const CELL_V_ALIGN_VALUES = new Set<string>(["top", "middle", "bottom"]);

/** Read a cell's own inline `text-align`/`vertical-align` back into this
 * schema's 2 cell-alignment attrs - shared by `cellAttributes`'s own
 * `getFromDOM` below (the live editor's `parseDOM`) and `html.ts`'s
 * `importTableElement` (built by hand rather than through this schema's
 * `parseDOM` - see that file's own doc comment, and `colWidthsFromElement`
 * above for the same split). */
export function cellHAlignFromElement(dom: HTMLElement | string): CellHAlign | null {
  if (typeof dom === "string") return null;
  const value = dom.style.textAlign;
  return CELL_H_ALIGN_VALUES.has(value) ? (value as CellHAlign) : null;
}
export function cellVAlignFromElement(dom: HTMLElement | string): CellVAlign | null {
  if (typeof dom === "string") return null;
  const value = dom.style.verticalAlign;
  return CELL_V_ALIGN_VALUES.has(value) ? (value as CellVAlign) : null;
}

/** Only non-default (`"left"`/`"middle"`, this schema's own browser-matching
 * defaults) alignment needs an explicit style fragment - mirrors
 * `withTextAlign`'s convention above. Shared by `cellAttributes`'s own
 * `setDOMAttr`s below and `html.ts`'s manual export equivalent. */
export function cellHAlignStyle(hAlign: CellHAlign | null): string {
  return hAlign && hAlign !== "left" ? `text-align:${hAlign};` : "";
}
export function cellVAlignStyle(vAlign: CellVAlign | null): string {
  return vAlign && vAlign !== "middle" ? `vertical-align:${vAlign};` : "";
}

/** `table`/`table_row`/`table_cell`/`table_header` node specs from
 * `prosemirror-tables`. Column-width resizing is hand-rolled
 * (`table-column-resize.ts`) rather than the package's own `columnResizing()`
 * plugin: that plugin's per-cell, pixel-based `colwidth` model doesn't fit
 * this field's own contract (table-level, integer-percent widths via a
 * `<colgroup>`, no colored resize-handle bar) - same reasoning
 * `table-row-resize.ts` already gives for hand-rolling row-height resizing.
 * `table` below adds `caption`/`colWidths` on top of the generated spec;
 * `table_row` adds `heightPx` (see `table-row-resize.ts`). `colspan`/
 * `rowspan` (from the generated `cellAttrs`) back this field's merge/split
 * cell actions (`table.ts`'s `unmergeCell`, `prosemirror-tables`' own
 * `mergeCells`). `hAlign`/`vAlign` (`table-cell-align-button.tsx`) ride along
 * on `cellAttributes` - the package's own generated `parseDOM`/`toDOM` calls
 * each entry's `getFromDOM`/`setDOMAttr` for every `table_cell`/`table_header`
 * automatically, so neither node needs its own override the way `table`/
 * `table_row` do above for their own extra attrs. */
const tableNodeSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {
    hAlign: {
      default: null,
      getFromDOM: cellHAlignFromElement,
      setDOMAttr(value, attrs) {
        const style = cellHAlignStyle(value as CellHAlign | null);
        if (style) attrs.style = `${attrs.style ?? ""}${style}`;
      },
    },
    vAlign: {
      default: null,
      getFromDOM: cellVAlignFromElement,
      setDOMAttr(value, attrs) {
        const style = cellVAlignStyle(value as CellVAlign | null);
        if (style) attrs.style = `${attrs.style ?? ""}${style}`;
      },
    },
  },
});

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { textAlign: { default: null } },
      parseDOM: [{ tag: "p", getAttrs: getTextAlignAttrs }],
      toDOM(node): DOMOutputSpec {
        return ["p", withTextAlign({}, node.attrs.textAlign as string | null), 0];
      },
    },
    heading: {
      group: "block",
      content: "inline*",
      defining: true,
      attrs: { level: { default: 2 }, textAlign: { default: null } },
      parseDOM: HEADING_LEVELS.map((level) => ({
        tag: `h${level}`,
        getAttrs: (dom: HTMLElement | string) => ({ level, ...getTextAlignAttrs(dom) }),
      })),
      toDOM(node): DOMOutputSpec {
        const level = node.attrs.level as number;
        return [`h${level}`, withTextAlign({}, node.attrs.textAlign as string | null), 0];
      },
    },
    blockquote: {
      group: "block",
      content: "inline*",
      attrs: { textAlign: { default: null } },
      parseDOM: [{ tag: "blockquote", getAttrs: getTextAlignAttrs }],
      toDOM(node): DOMOutputSpec {
        return ["blockquote", withTextAlign({}, node.attrs.textAlign as string | null), 0];
      },
    },
    list_item: {
      content: "block+",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM(): DOMOutputSpec {
        return liDOM;
      },
    },
    bullet_list: {
      group: "block",
      content: "list_item+",
      parseDOM: [{ tag: "ul" }],
      toDOM(): DOMOutputSpec {
        return ulDOM;
      },
    },
    ordered_list: {
      group: "block",
      content: "list_item+",
      attrs: { start: { default: 1 } },
      parseDOM: [
        {
          tag: "ol",
          getAttrs(dom: HTMLElement | string) {
            if (typeof dom === "string") return { start: 1 };
            const start = Number((dom as HTMLOListElement).start);
            return { start: Number.isFinite(start) && start > 0 ? start : 1 };
          },
        },
      ],
      toDOM(node): DOMOutputSpec {
        return node.attrs.start === 1 ? olDOM : ["ol", { start: node.attrs.start as number }, 0];
      },
    },
    table: {
      ...tableNodeSpecs.table,
      attrs: { caption: { default: "" }, colWidths: { default: null } },
      parseDOM: [{ tag: "table", getAttrs: getTableAttrs }],
      toDOM(node): DOMOutputSpec {
        const caption = node.attrs.caption as string;
        const colgroup = colgroupDOMSpec(node.attrs.colWidths as number[] | null);
        const children: DOMOutputSpec[] = [];
        if (caption) children.push(["caption", { contenteditable: "false" }, caption]);
        if (colgroup) children.push(colgroup);
        children.push(["tbody", 0]);
        return ["div", { class: "tableWrapper" }, ["table", ...children]];
      },
    },
    table_row: {
      ...tableNodeSpecs.table_row,
      attrs: { heightPx: { default: null } },
      parseDOM: [{ tag: "tr", getAttrs: getRowHeightAttrs }],
      toDOM(node): DOMOutputSpec {
        const style = rowHeightStyleString(node.attrs.heightPx as number | null);
        return ["tr", style ? { style } : {}, 0];
      },
    },
    table_cell: tableNodeSpecs.table_cell,
    table_header: tableNodeSpecs.table_header,
    text: { group: "inline" },
    hard_break: {
      group: "inline",
      inline: true,
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM(): DOMOutputSpec {
        return ["br"];
      },
    },
    image: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: {
        src: {},
        alt: { default: "" },
        width: { default: null },
        height: { default: null },
        align: { default: null },
        objectFit: { default: "contain" },
        // Read/written by `html.ts`'s manual `<figure>`/`<figcaption>`
        // handling, not by this node's own `parseDOM`/`toDOM` below (which
        // only ever see the bare `<img>` - a caption lives on a *sibling*
        // element, outside what a single-tag `parseDOM` rule can reach).
        // Clipboard-pasted HTML from outside this field therefore keeps an
        // image's caption only if it round-trips through `html.ts` first.
        caption: { default: "" },
        // Editor-only convenience flag for the resize handles (`image-view.ts`)
        // and the edit dialog's width/height fields (`image-menu.tsx`) - not
        // read by `parseDOM`/written by `toDOM` below, so it resets to its
        // default on reload rather than round-tripping through saved HTML.
        // Defaults locked, matching drystack's own default.
        lockAspectRatio: { default: true },
      },
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs(dom: HTMLElement | string) {
            if (typeof dom === "string") return false;
            return {
              src: dom.getAttribute("src") ?? "",
              alt: dom.getAttribute("alt") ?? "",
              ...imageSizeFromElement(dom),
              align: parseImageAlign(dom),
              objectFit: imageObjectFitFromElement(dom),
            };
          },
        },
      ],
      toDOM(node): DOMOutputSpec {
        const style = imageStyleString(
          node.attrs.width as number | null,
          node.attrs.height as number | null,
          node.attrs.align as ImageAlign | null,
          node.attrs.lockAspectRatio ? null : (node.attrs.objectFit as ImageObjectFit),
        );
        return [
          "img",
          {
            src: node.attrs.src as string,
            alt: node.attrs.alt as string,
            class: "dry-tx-image",
            ...(style ? { style } : {}),
          },
        ];
      },
    },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight", getAttrs: (value) => (/^(bold(er)?|[5-9]\d{2,})$/.test(value as string) ? null : false) }],
      toDOM(): DOMOutputSpec {
        return ["strong", 0];
      },
    },
    italic: {
      parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
      toDOM(): DOMOutputSpec {
        return ["em", 0];
      },
    },
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM(): DOMOutputSpec {
        return ["u", 0];
      },
    },
    // The field's own clean HTML contract: a plain `style="color: ..."` span
    // - any CSS color value (hex6/hex8/`currentColor`/named). Deliberately
    // not drystack's stricter `data-dry-text-color` + 8-digit-hex-only
    // encoding (schema.tsx's `textColor` mark) - nothing downstream needs
    // that compatibility, only this field's own export/import round-trip.
    textColor: {
      attrs: { value: {} },
      parseDOM: [
        {
          style: "color",
          getAttrs(value) {
            return typeof value === "string" && value ? { value } : false;
          },
        },
      ],
      toDOM(mark): DOMOutputSpec {
        return ["span", { style: `color: ${mark.attrs.value as string}` }, 0];
      },
    },
  },
});

export function createEmptyDoc(): PMNode {
  return schema.nodes.doc!.createAndFill()!;
}

const HEADING_TAG_TO_LEVEL: Record<string, number> = { H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

/** Inverse of `blockNodeType`/`blockNodeAttrs` below - reads which
 * `BlockType` a top-level element currently is. */
export function blockTypeOfNode(node: PMNode): BlockType {
  if (node.type === schema.nodes.blockquote) return "quote";
  if (node.type === schema.nodes.heading) return `h${node.attrs.level as number}` as BlockType;
  return "paragraph";
}

/** The node type + attrs `BlockType` maps to - used both by the block-type
 * toolbar command and by `html.ts` when importing hand-written HTML. */
export function blockNodeTypeAndAttrs(type: BlockType): { type: NodeType; attrs: Attrs | null } {
  if (type === "quote") return { type: schema.nodes.blockquote!, attrs: null };
  if (type === "paragraph") return { type: schema.nodes.paragraph!, attrs: null };
  return { type: schema.nodes.heading!, attrs: { level: Number(type.slice(1)) } };
}

export function blockTypeFromTagName(tagName: string): BlockType {
  if (tagName === "BLOCKQUOTE") return "quote";
  const level = HEADING_TAG_TO_LEVEL[tagName];
  return level ? (`h${level}` as BlockType) : "paragraph";
}
