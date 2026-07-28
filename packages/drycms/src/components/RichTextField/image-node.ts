import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";

export type SerializedImageNode = Spread<{ src: string; alt: string }, SerializedLexicalNode>;

/**
 * A single inline `<img>` - inserted via the toolbar's "Insert image" button
 * (see `image-insert-button.tsx`) as a child of whichever block (paragraph/
 * heading/quote) had focus when the picker opened, the same way `<em>`/
 * `<strong>` sit among a block's text runs rather than as their own
 * top-level element. Round-tripped by `./html.ts` directly (not through
 * `block-nodes.ts`'s `BlockType`/"turn into" system - there's nothing to
 * turn an image into, or vice versa).
 *
 * `DecoratorNode`, not `ElementNode`: an image has no text content for a
 * caret to sit inside, and core Lexical only gives arrow-key hop-over and
 * atomic backspace/delete (remove the whole node in one keystroke, rather
 * than trying to edit "inside" it) to nodes it recognizes via
 * `$isDecoratorNode` - an empty `ElementNode` doesn't get either. This
 * project has no `@lexical/react`-style decorator *renderer* wired up, but
 * doesn't need one: `decorate()`'s return value only matters to that
 * renderer, and this field builds the DOM itself in `createDOM`/`updateDOM`,
 * same as every other node here.
 */
export class ImageNode extends DecoratorNode<null> {
  __src: string;
  __alt: string;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__key);
  }

  constructor(src: string, alt: string, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__alt = alt;
  }

  getSrc(): string {
    return this.__src;
  }

  getAlt(): string {
    return this.__alt;
  }

  createDOM(): HTMLElement {
    const img = document.createElement("img");
    img.src = this.__src;
    img.alt = this.__alt;
    img.className = "richtext-image";
    return img;
  }

  updateDOM(prevNode: ImageNode, dom: HTMLElement): boolean {
    const img = dom as HTMLImageElement;
    if (prevNode.__src !== this.__src) img.src = this.__src;
    if (prevNode.__alt !== this.__alt) img.alt = this.__alt;
    return false;
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode(serializedNode.src, serializedNode.alt).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedImageNode {
    return { ...super.exportJSON(), src: this.__src, alt: this.__alt };
  }
}

export function $createImageNode(src: string, alt: string): ImageNode {
  return new ImageNode(src, alt);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
