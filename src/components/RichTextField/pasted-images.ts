import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { schema } from "./schema.js";

export interface PastedImage {
  src: string;
  file?: File;
  occurrence?: number;
}

const IMAGE_URL = /^https?:\/\/[^\s]+\.(?:avif|gif|jpe?g|png|webp)(?:[?#][^\s]*)?$/i;

const TEXT_STYLES = new Set(["color", "font-weight", "font-style", "text-decoration", "text-align"]);
/** `display` + the two `margin-inline` longhands carry the center encoding
 * (`schema.ts`'s `imageAlignStyleString`) - `margin-inline: auto` is listed
 * by `CSSStyleDeclaration` under its longhand names, never the shorthand, so
 * those are the names a paste has to be checked against. `min-width` is the
 * legacy center marker, kept so older copied content still pastes centered. */
const IMAGE_STYLES = new Set([
  "width",
  "height",
  "object-fit",
  "float",
  "min-width",
  "display",
  "margin-inline-start",
  "margin-inline-end",
]);
const TABLE_STYLES = new Set(["width", "height", "text-align", "vertical-align"]);
const GRID_STYLES = new Set(["display", "grid-template-columns", "grid-column", "grid-row", "gap"]);

function keepSupportedStyle(element: HTMLElement, name: string): boolean {
  const value = element.style.getPropertyValue(name).trim().toLowerCase();
  if (name === "color") return value !== "";
  if (name === "font-weight") return /^(?:bold(?:er)?|[5-9]00)$/.test(value);
  if (name === "font-style") return value === "italic";
  if (name === "text-decoration") {
    if (!value.includes("underline")) return false;
    element.style.setProperty(name, "underline");
    return true;
  }
  if (name === "text-align") return /^(?:left|center|right|justify)$/.test(value);

  if (element.tagName === "IMG" || element.tagName === "FIGURE") {
    if (name === "width" || name === "height") return Number.parseFloat(value) > 0;
    if (name === "object-fit") return /^(?:fill|cover|contain)$/.test(value);
    if (name === "float") return /^(?:left|right)$/.test(value);
    if (name === "min-width") return value === "100%";
    // `block` is the centered `<img>`'s own display, `table` the captioned
    // `<figure>`'s shrink-wrap - no other value is part of this vocabulary.
    if (name === "display") return value === "block" || value === "table";
    if (name === "margin-inline-start" || name === "margin-inline-end") return value === "auto";
  }
  if (["TABLE", "TR", "TD", "TH", "COL"].includes(element.tagName)) {
    if (name === "text-align") return /^(?:left|center|right|justify)$/.test(value);
    if (name === "vertical-align") return /^(?:top|middle|bottom)$/.test(value);
    if (name === "width" || name === "height") return Number.parseFloat(value) > 0;
  }
  if (element.classList.contains("dry-tx-grid") || element.classList.contains("dry-tx-grid-item")) {
    return GRID_STYLES.has(name);
  }
  return false;
}

/** Removes clipboard-only layout/font noise while preserving the small CSS
 * vocabulary the RichText schema can actually round-trip. */
export function sanitizePastedHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("[style]"))) {
    const allowed = new Set(TEXT_STYLES);
    if (element.tagName === "IMG" || element.tagName === "FIGURE") for (const name of IMAGE_STYLES) allowed.add(name);
    if (["TABLE", "TR", "TD", "TH", "COL"].includes(element.tagName)) for (const name of TABLE_STYLES) allowed.add(name);
    if (element.classList.contains("dry-tx-grid") || element.classList.contains("dry-tx-grid-item")) {
      for (const name of GRID_STYLES) allowed.add(name);
    }
    for (const name of Array.from(element.style)) {
      if (!allowed.has(name) || !keepSupportedStyle(element, name)) element.style.removeProperty(name);
    }
    if (!element.style.length) element.removeAttribute("style");
  }
  return document.body.innerHTML;
}

export function pastedImagesFromClipboard(data: DataTransfer): PastedImage[] {
  const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (files.length) return files.map((file) => ({ src: URL.createObjectURL(file), file }));

  const html = data.getData("text/html");
  if (html) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const images = Array.from(document.querySelectorAll("img[src]"))
      .map((image) => image.getAttribute("src")?.trim() ?? "")
      .filter((src) => /^https?:\/\//i.test(src));
    if (images.length) {
      const seen = new Map<string, number>();
      return images.map((src) => {
        const occurrence = seen.get(src) ?? 0;
        seen.set(src, occurrence + 1);
        return { src, occurrence };
      });
    }
  }

  const text = data.getData("text/plain").trim();
  return IMAGE_URL.test(text) ? [{ src: text }] : [];
}

export function insertPastedImageFiles(view: EditorView, images: PastedImage[]): void {
  const [first, ...rest] = images.map(({ src, file }) => schema.nodes.image!.create({ src, alt: file?.name ?? "" }));
  if (!first) return;
  const tr = view.state.tr.replaceSelectionWith(first);
  if (rest.length) tr.insert(tr.selection.to, rest);
  view.dispatch(tr);
}

export function replaceImageSource(view: EditorView, from: string, to: string, occurrence = 0): boolean {
  let found: { pos: number; node: PMNode } | null = null;
  let currentOccurrence = 0;
  view.state.doc.descendants((node, pos) => {
    if (!found && node.type === schema.nodes.image && node.attrs.src === from) {
      if (currentOccurrence === occurrence) found = { pos, node };
      currentOccurrence += 1;
    }
  });
  if (!found) return false;
  const match = found as { pos: number; node: PMNode };
  view.dispatch(view.state.tr.setNodeMarkup(match.pos, undefined, { ...match.node.attrs, src: to }));
  return true;
}

export function pastedImageName(src: string, contentType = ""): string {
  try {
    const name = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "").replace(/[^A-Za-z0-9._-]+/g, "-");
    if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
  } catch {
    // Object URLs are opaque; the MIME fallback below gives them a stable name.
  }
  const extension = contentType.split(";")[0]?.split("/")[1]?.replace("jpeg", "jpg").replace(/[^A-Za-z0-9]/g, "") || "png";
  return `pasted-image.${extension}`;
}
