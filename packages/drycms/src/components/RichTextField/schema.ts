import { Schema, type Attrs, type DOMOutputSpec, type Node as PMNode, type NodeType } from "prosemirror-model";
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
 * default cap on an unsized image (`.richtext-image` in forms.css), which
 * would otherwise clamp a deliberately-resized-larger image right back
 * down. Split out from `imageStyleString` below so a captioned image
 * (`exportCleanHtml`'s `<figure>` case) can put size/fit on the `<img>`
 * itself and align on the `<figure>` wrapping it, instead of both landing
 * on the same element the way the uncaptioned case does. */
export function imageSizeAndFitStyleString(width: number | null, height: number | null, objectFit: ImageObjectFit): string {
  const parts: string[] = [];
  if (width != null) parts.push(`width:${width}px`, "max-width:none");
  if (height != null) parts.push(`height:${height}px`, "max-height:none");
  if (width != null || height != null) parts.push(`object-fit:${objectFit}`);
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
  objectFit: ImageObjectFit,
): string {
  return [imageSizeAndFitStyleString(width, height, objectFit), imageAlignStyleString(align)].filter(Boolean).join(";");
}

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
          node.attrs.objectFit as ImageObjectFit,
        );
        return [
          "img",
          {
            src: node.attrs.src as string,
            alt: node.attrs.alt as string,
            class: "richtext-image",
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
