import {
  $createParagraphNode,
  ElementNode,
  createCommand,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import type { BlockType } from "./types.js";

export type HeadingTag = "h2" | "h3" | "h4" | "h5" | "h6";

export type SerializedHeadingNode = Spread<{ tag: HeadingTag }, SerializedElementNode>;

/**
 * A `<h2>`-`<h6>` top-level block. `@lexical/rich-text`'s own `HeadingNode`
 * also carries `<h1>` and its own DOM-import/HTML-export machinery this field
 * doesn't use - HTML round-tripping is `./html.ts`'s job, same as paragraphs
 * - so this is a thin from-scratch equivalent instead of the extra
 * dependency.
 */
export class HeadingNode extends ElementNode {
  __tag: HeadingTag;

  static getType(): string {
    return "heading";
  }

  static clone(node: HeadingNode): HeadingNode {
    return new HeadingNode(node.__tag, node.__key);
  }

  constructor(tag: HeadingTag, key?: NodeKey) {
    super(key);
    this.__tag = tag;
  }

  getTag(): HeadingTag {
    return this.__tag;
  }

  createDOM(): HTMLElement {
    return document.createElement(this.__tag);
  }

  updateDOM(): boolean {
    return false;
  }

  // Splitting mid-heading keeps typing in a heading of the same tag, but
  // Enter at the end of one drops back to a paragraph - otherwise a title
  // followed by body text would need a manual "change block type" step.
  insertNewAfter(selection: RangeSelection): ElementNode {
    const anchorOffset = selection.anchor.offset;
    const lastDescendant = this.getLastDescendant();
    const isAtEnd =
      !lastDescendant ||
      (selection.anchor.key === lastDescendant.getKey() && anchorOffset === lastDescendant.getTextContentSize());
    const newElement = isAtEnd ? $createParagraphNode() : $createHeadingNode(this.__tag);
    newElement.setFormat(this.getFormatType());
    this.insertAfter(newElement);
    return newElement;
  }

  static importJSON(serializedNode: SerializedHeadingNode): HeadingNode {
    return $createHeadingNode(serializedNode.tag).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedHeadingNode {
    return { ...super.exportJSON(), tag: this.__tag };
  }
}

export function $createHeadingNode(tag: HeadingTag): HeadingNode {
  return new HeadingNode(tag);
}

export function $isHeadingNode(node: LexicalNode | null | undefined): node is HeadingNode {
  return node instanceof HeadingNode;
}

/** A `<blockquote>` top-level block - see `HeadingNode` above for why this is
 * hand-rolled instead of pulling in `@lexical/rich-text`. */
export class QuoteNode extends ElementNode {
  static getType(): string {
    return "quote";
  }

  static clone(node: QuoteNode): QuoteNode {
    return new QuoteNode(node.__key);
  }

  createDOM(): HTMLElement {
    return document.createElement("blockquote");
  }

  updateDOM(): boolean {
    return false;
  }

  // Enter always exits the quote to a plain paragraph rather than splitting
  // into a second blockquote - a quote is one excerpt, not a repeatable item.
  insertNewAfter(): ElementNode {
    const newElement = $createParagraphNode();
    newElement.setFormat(this.getFormatType());
    this.insertAfter(newElement);
    return newElement;
  }

  static importJSON(serializedNode: SerializedElementNode): QuoteNode {
    return $createQuoteNode().updateFromJSON(serializedNode);
  }
}

export function $createQuoteNode(): QuoteNode {
  return new QuoteNode();
}

export function $isQuoteNode(node: LexicalNode | null | undefined): node is QuoteNode {
  return node instanceof QuoteNode;
}

/** Dispatched with the requested `BlockType` - handled in
 * `useRichTextEditor.ts` by swapping every top-level element the selection
 * touches for a freshly created node of that type (children carried over via
 * `replace(..., true)`), the same "replace the element" shape core Lexical's
 * `FORMAT_ELEMENT_COMMAND` handler uses for alignment. */
export const FORMAT_BLOCK_TYPE_COMMAND: LexicalCommand<BlockType> = createCommand("FORMAT_BLOCK_TYPE_COMMAND");

export function $createBlockNode(type: BlockType): ElementNode {
  if (type === "quote") return $createQuoteNode();
  if (type === "paragraph") return $createParagraphNode();
  return $createHeadingNode(type);
}

/** Reads which `BlockType` a top-level element currently is - the inverse of
 * `$createBlockNode`. */
export function $getBlockType(element: ElementNode): BlockType {
  if ($isHeadingNode(element)) return element.getTag();
  if ($isQuoteNode(element)) return "quote";
  return "paragraph";
}

const HEADING_TAG_NAMES: ReadonlySet<string> = new Set(["H2", "H3", "H4", "H5", "H6"]);

/** Maps an imported HTML tag name (from `DOMParser`, always upper-case) to
 * the `BlockType` it represents - unrecognized tags fall back to
 * `"paragraph"`, the same default `html.ts` used before block types existed. */
export function $blockTypeFromTagName(tagName: string): BlockType {
  if (tagName === "BLOCKQUOTE") return "quote";
  if (HEADING_TAG_NAMES.has(tagName)) return tagName.toLowerCase() as HeadingTag;
  return "paragraph";
}

/** The HTML tag `$exportCleanHtml` should wrap a block of this type in. */
export function $blockTag(type: BlockType): string {
  return type === "quote" ? "blockquote" : type === "paragraph" ? "p" : type;
}
