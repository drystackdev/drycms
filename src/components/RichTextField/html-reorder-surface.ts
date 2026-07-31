import { importCleanHtml } from "./html.js";
import { schema } from "./schema.js";

type CommitHtml = (html: string) => void;

const BLOCK_TAGS = new Set([
  "BLOCKQUOTE",
  "FIGURE",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "OL",
  "P",
  "TABLE",
  "TR",
  "UL",
]);

const FLOW_CONTAINERS = new Set(["BLOCKQUOTE", "LI", "TD", "TH"]);
const LISTS = new Set(["UL", "OL"]);
const TABLE_SECTIONS = new Set(["THEAD", "TBODY", "TFOOT"]);

interface DropLocation {
  parent: Element;
  before: Node | null;
  target: Element | null;
}

interface DragState {
  source: HTMLElement;
  placeholder: HTMLElement;
  overlay: HTMLElement;
  startX: number;
  startY: number;
  height: number;
  initialHtml: string;
  location: DropLocation | null;
}

function isTableWrapper(el: Element): boolean {
  return el instanceof HTMLElement && el.classList.contains("tableWrapper");
}

function isGrid(el: Element): boolean {
  return el instanceof HTMLElement && el.classList.contains("dry-tx-grid");
}

function isGridItem(el: Element): boolean {
  return el instanceof HTMLElement && el.classList.contains("dry-tx-grid-item");
}

function dryNodeType(el: Element) {
  const tag = el.tagName.toLowerCase();
  if (!tag.startsWith("dry-")) return undefined;
  return schema.nodes[`dry_${tag.slice("dry-".length)}`];
}

function isDryBlock(el: Element): boolean {
  return dryNodeType(el)?.isBlock ?? false;
}

function isDryFlowContainer(el: Element): boolean {
  const content = dryNodeType(el)?.spec.content;
  return typeof content === "string" && content.includes("block");
}

function isAtomic(el: Element): boolean {
  return el.tagName === "FIGURE" || isTableWrapper(el) || (el instanceof HTMLElement && el.dataset.reorderAtomic === "true");
}

function isItem(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName) || isTableWrapper(el) || isGrid(el) || isDryBlock(el);
}

function isFlowContainer(el: Element): boolean {
  return FLOW_CONTAINERS.has(el.tagName) || LISTS.has(el.tagName) || isGrid(el) || isGridItem(el) || isDryFlowContainer(el);
}

function isStructuralContainer(el: Element): boolean {
  return el.tagName === "TABLE" || el.tagName === "TR" || el.tagName === "TD" || el.tagName === "TH" || TABLE_SECTIONS.has(el.tagName);
}

function isPhrasingOnly(el: Element): boolean {
  return ["P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(el.tagName);
}

function isTrailingLandingParagraph(el: Element, surface: HTMLElement): boolean {
  return (
    el.tagName === "P" &&
    el.parentElement === surface &&
    el.nextElementSibling == null &&
    !(el.textContent ?? "").trim() &&
    el.children.length === 0
  );
}

function nearest(root: HTMLElement, target: Element | null, selector: string): Element | null {
  let current = target;
  while (current && current !== root) {
    if (current.matches(selector)) return current;
    current = current.parentElement;
  }
  return null;
}

function elementAtPoint(root: HTMLElement, x: number, y: number): Element | null {
  const rootNode = root.getRootNode();
  if (rootNode instanceof ShadowRoot) return rootNode.elementFromPoint(x, y);
  return document.elementFromPoint(x, y);
}

function sourceCanEnter(source: HTMLElement, parent: Element): boolean {
  if (parent === source || source.contains(parent)) return false;
  if (isAtomic(parent) || isPhrasingOnly(parent)) return false;
  if (parent.tagName === "TABLE" || TABLE_SECTIONS.has(parent.tagName)) return source.tagName === "TR";
  if (parent.tagName === "TR") return false;
  if (parent.tagName === "UL" || parent.tagName === "OL") return source.tagName === "LI" || isItem(source);
  if (parent.tagName === "TD" || parent.tagName === "TH") return source.tagName !== "TR" && source.tagName !== "TD" && source.tagName !== "TH";
  if (isGridItem(parent)) return isItem(source) && !isGrid(source);
  return isFlowContainer(parent) || parent.classList.contains("dry-html-reorder-surface");
}

function insertionForTarget(root: HTMLElement, source: HTMLElement, target: Element | null, y: number): DropLocation | null {
  if (!target || target === source || source.contains(target)) return null;

  const row = target.closest("tr");
  if (source.tagName === "TR") {
    if (!row || row.parentElement == null || row.parentElement !== source.parentElement) return null;
    const rect = row.getBoundingClientRect();
    const parent = row.parentElement;
    return { parent, before: y < rect.top + rect.height / 2 ? row : row.nextSibling, target: row };
  }

  const cell = target.closest("td, th");
  if (cell && sourceCanEnter(source, cell)) {
    return { parent: cell, before: null, target: cell };
  }

  const containingListItem = target.closest("li");
  const listItemChild = nearest(root, target, "[data-reorder-item]");
  if (
    containingListItem &&
    listItemChild &&
    listItemChild !== containingListItem &&
    listItemChild.parentElement === containingListItem &&
    sourceCanEnter(source, containingListItem)
  ) {
    const rect = listItemChild.getBoundingClientRect();
    return {
      parent: containingListItem,
      before: y < rect.top + rect.height / 2 ? listItemChild : listItemChild.nextSibling,
      target: listItemChild,
    };
  }

  const list = target.closest("ul, ol");
  if (list && sourceCanEnter(source, list)) {
    const item = target.closest("li");
    if (item && item.parentElement === list) {
      const rect = item.getBoundingClientRect();
      return { parent: list, before: y < rect.top + rect.height / 2 ? item : item.nextSibling, target: item };
    }
    return { parent: list, before: null, target: list };
  }

  const gridItem = target.closest(".dry-tx-grid-item");
  if (gridItem && sourceCanEnter(source, gridItem)) return { parent: gridItem, before: null, target: gridItem };

  const grid = target.closest(".dry-tx-grid");
  if (grid && sourceCanEnter(source, grid)) {
    const gridChild = nearest(root, target, "[data-reorder-item]");
    if (gridChild && gridChild !== grid && gridChild.parentElement === grid) {
      const rect = gridChild.getBoundingClientRect();
      return {
        parent: grid,
        before: y < rect.top + rect.height / 2 ? gridChild : gridChild.nextSibling,
        target: gridChild,
      };
    }
    return { parent: grid, before: null, target: grid };
  }

  const flowContainer = nearest(root, target, "[data-reorder-container]");
  const flowItem = nearest(root, target, "[data-reorder-item]");
  if (
    flowContainer &&
    flowItem === flowContainer &&
    !isStructuralContainer(flowContainer) &&
    sourceCanEnter(source, flowContainer)
  ) {
    return { parent: flowContainer, before: null, target: flowContainer };
  }

  const item = nearest(root, target, "[data-reorder-item]");
  if (!item || isAtomic(item)) {
    if (!item?.parentElement || !sourceCanEnter(source, item.parentElement)) return null;
    const rect = item.getBoundingClientRect();
    return {
      parent: item.parentElement,
      before: y < rect.top + rect.height / 2 ? item : item.nextSibling,
      target: item,
    };
  }
  const parent = item.parentElement;
  if (!parent || !sourceCanEnter(source, parent)) return null;
  const rect = item.getBoundingClientRect();
  return { parent, before: y < rect.top + rect.height / 2 ? item : item.nextSibling, target: item };
}

function unwrapIfNeeded(source: HTMLElement, parent: Element): Node[] {
  if (source.tagName !== "LI" || LISTS.has(parent.tagName)) return [source];
  const output: Node[] = [];
  let inline: Node[] = [];
  const flushInline = () => {
    if (inline.length === 0) return;
    const paragraph = source.ownerDocument.createElement("p");
    paragraph.append(...inline);
    output.push(paragraph);
    inline = [];
  };
  for (const node of Array.from(source.childNodes)) {
    if (node instanceof HTMLElement && node.matches(".dry-html-reorder-handle")) continue;
    if (node instanceof Element && isItem(node)) {
      flushInline();
      output.push(node);
    } else {
      inline.push(node);
    }
  }
  flushInline();
  return output.length > 0 ? output : [source.ownerDocument.createElement("p")];
}

function insertAt(location: DropLocation, source: HTMLElement): void {
  const { parent, before } = location;
  const nodes = unwrapIfNeeded(source, parent);
  if (LISTS.has(parent.tagName) && source.tagName !== "LI") {
    const li = parent.ownerDocument.createElement("li");
    li.append(...nodes);
    parent.insertBefore(li, before);
    return;
  }
  parent.insertBefore(nodes[0]!, before);
  for (const node of nodes.slice(1)) parent.insertBefore(node, before);
}

function createPlaceholder(parent: Element, source: HTMLElement, height: number): HTMLElement {
  const document = parent.ownerDocument;
  let placeholder: HTMLElement;
  if (LISTS.has(parent.tagName)) {
    placeholder = document.createElement("li");
  } else if (TABLE_SECTIONS.has(parent.tagName)) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = Math.max(1, source.tagName === "TR" ? source.children.length : 1);
    row.append(cell);
    placeholder = row;
  } else {
    placeholder = document.createElement("div");
  }
  placeholder.className = "dry-html-reorder-placeholder";
  placeholder.style.height = `${height}px`;
  return placeholder;
}

function movePlaceholder(drag: DragState, location: DropLocation): void {
  const expected = createPlaceholder(location.parent, drag.source, drag.height);
  if (expected.tagName !== drag.placeholder.tagName) {
    drag.placeholder.replaceWith(expected);
    drag.placeholder = expected;
  }
  location.parent.insertBefore(drag.placeholder, location.before);
}

function stripReorderUi(root: HTMLElement): void {
  root.querySelectorAll(".dry-html-reorder-handle, .dry-html-reorder-placeholder").forEach((el) => el.remove());
  root.querySelectorAll("[data-reorder-item], [data-reorder-container], [data-reorder-atomic], [data-reorder-handle-owner]").forEach((el) => {
    el.removeAttribute("data-reorder-item");
    el.removeAttribute("data-reorder-container");
    el.removeAttribute("data-reorder-atomic");
    el.removeAttribute("data-reorder-handle-owner");
  });
  root.querySelectorAll(".dry-html-reorder-item, .dry-html-reorder-dragging, .dry-html-reorder-overlay, .dry-html-reorder-drop-target, .dry-html-reorder-trailing").forEach((el) => {
    el.classList.remove(
      "dry-html-reorder-item",
      "dry-html-reorder-dragging",
      "dry-html-reorder-overlay",
      "dry-html-reorder-drop-target",
      "dry-html-reorder-trailing",
    );
  });
  root.querySelectorAll("[class]").forEach((el) => {
    if (!el.getAttribute("class")?.trim()) el.removeAttribute("class");
  });
}

function cleanForCommit(surface: HTMLElement): string {
  const clone = surface.cloneNode(true) as HTMLElement;
  stripReorderUi(clone);
  return clone.innerHTML;
}

function addHandle(owner: HTMLElement, surface: HTMLElement): void {
  if (
    Array.from(owner.querySelectorAll<HTMLElement>(".dry-html-reorder-handle"))
      .some((handle) => handle.dataset.reorderHandleItem === owner.dataset.reorderItem)
  ) return;
  const button = surface.ownerDocument.createElement("button");
  button.type = "button";
  const isWholeContainer =
    LISTS.has(owner.tagName) ||
    owner.tagName === "TABLE" ||
    owner.tagName === "BLOCKQUOTE" ||
    isGrid(owner) ||
    isDryFlowContainer(owner);
  button.className = `dry-html-reorder-handle${isWholeContainer ? " dry-html-reorder-handle-container" : ""}`;
  const label =
    owner.tagName === "TR" ? "Move table row" :
    owner.tagName === "TABLE" ? "Move table" :
    LISTS.has(owner.tagName) ? "Move list" :
    owner.tagName === "BLOCKQUOTE" ? "Move quote" :
    owner.tagName === "FIGURE" ? "Move figure" :
    "Move block";
  button.setAttribute("aria-label", label);
  button.dataset.reorderHandleOwner = "true";
  button.dataset.reorderHandleItem = owner.dataset.reorderItem ?? "";
  if (owner.tagName === "TR" || owner.tagName === "TABLE") {
    owner.querySelector("td, th")?.prepend(button);
  } else if (LISTS.has(owner.tagName)) {
    owner.querySelector(":scope > li")?.prepend(button);
  } else if (isTableWrapper(owner)) {
    owner.prepend(button);
  } else {
    owner.prepend(button);
  }
}

function decorate(surface: HTMLElement): void {
  stripReorderUi(surface);
  let id = 0;
  const elements = Array.from(surface.querySelectorAll("*"));
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;
    if (isTrailingLandingParagraph(element, surface)) {
      element.classList.add("dry-html-reorder-trailing");
      continue;
    }
    if (isItem(element)) {
      element.dataset.reorderItem = String(++id);
      element.classList.add("dry-html-reorder-item");
      if (isAtomic(element)) element.dataset.reorderAtomic = "true";
      if (!isStructuralContainer(element) || element.tagName === "TR" || element.tagName === "TABLE") {
        addHandle(element, surface);
      }
    }
    if (isFlowContainer(element) || isStructuralContainer(element)) element.dataset.reorderContainer = "true";
  }
}

export class HtmlReorderSurface {
  private readonly host: HTMLElement;
  private readonly onCommit: CommitHtml;
  private surface: HTMLDivElement | null = null;
  private drag: DragState | null = null;

  constructor(host: HTMLElement, onCommit: CommitHtml) {
    this.host = host;
    this.onCommit = onCommit;
  }

  setActive(active: boolean, html?: string): void {
    if (!active) {
      if (this.drag && this.surface) {
        window.removeEventListener("pointermove", this.onPointerMove);
        window.removeEventListener("pointerup", this.onPointerUp);
        window.removeEventListener("pointercancel", this.onPointerUp);
        this.drag.overlay.remove();
        this.surface.innerHTML = this.drag.initialHtml;
        this.drag = null;
        decorate(this.surface);
      }
      const committedHtml = this.surface && !this.drag ? cleanForCommit(this.surface) : null;
      this.destroySurface();
      this.host.classList.remove("dry-tx-html-reorder-host");
      if (committedHtml != null) this.onCommit(committedHtml);
      return;
    }
    this.host.classList.add("dry-tx-html-reorder-host");
    if (!this.surface) {
      this.surface = this.host.ownerDocument.createElement("div");
      this.surface.className = "dry-html-reorder-surface dry-tx-content";
      this.surface.addEventListener("pointerdown", this.onPointerDown);
      this.host.insertBefore(this.surface, this.host.firstChild);
    }
    if (html !== undefined && !this.drag) {
      this.surface.innerHTML = html;
      decorate(this.surface);
    }
  }

  destroy(): void {
    this.destroySurface();
  }

  private destroySurface(): void {
    if (this.drag) {
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("pointercancel", this.onPointerUp);
      this.drag.overlay.remove();
      this.drag.placeholder.remove();
      this.drag.source.classList.remove("dry-html-reorder-dragging");
      this.drag = null;
    }
    if (!this.surface) return;
    this.surface.removeEventListener("pointerdown", this.onPointerDown);
    this.surface.remove();
    this.surface = null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    const surface = this.surface;
    if (!surface || event.button !== 0) return;
    const handle = (event.target as Element | null)?.closest(".dry-html-reorder-handle");
    if (!(handle instanceof HTMLElement)) return;
    const handleId = handle.dataset.reorderHandleItem;
    const source = handleId
      ? Array.from(surface.querySelectorAll<HTMLElement>("[data-reorder-item]"))
          .find((element) => element.dataset.reorderItem === handleId) ?? null
      : handle.closest<HTMLElement>("[data-reorder-item]");
    if (!source || source === surface) return;
    event.preventDefault();
    event.stopPropagation();
    const initialHtml = surface.innerHTML;
    const rect = source.getBoundingClientRect();
    const placeholder = createPlaceholder(source.parentElement ?? surface, source, rect.height);
    source.before(placeholder);
    source.classList.add("dry-html-reorder-dragging");
    const overlay = source.cloneNode(true) as HTMLElement;
    overlay.classList.add("dry-html-reorder-overlay");
    overlay.style.position = "fixed";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.pointerEvents = "none";
    (surface.getRootNode() instanceof ShadowRoot ? surface.getRootNode() : surface.ownerDocument.body).appendChild(overlay);
    this.drag = {
      source,
      placeholder,
      overlay,
      startX: event.clientX,
      startY: event.clientY,
      height: rect.height,
      initialHtml,
      location: null,
    };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    const surface = this.surface;
    if (!drag || !surface) return;
    drag.overlay.style.transform = `translate(${event.clientX - drag.startX}px, ${event.clientY - drag.startY}px)`;
    const target = elementAtPoint(surface, event.clientX, event.clientY);
    const location = insertionForTarget(surface, drag.source, target, event.clientY);
    if (!location || location.parent === drag.placeholder.parentElement && location.before === drag.placeholder) return;
    drag.location = location;
    movePlaceholder(drag, location);
    surface.querySelectorAll(".dry-html-reorder-drop-target").forEach((el) => el.classList.remove("dry-html-reorder-drop-target"));
    location.target?.classList.add("dry-html-reorder-drop-target");
  };

  private onPointerUp = (event?: PointerEvent): void => {
    const drag = this.drag;
    const surface = this.surface;
    if (!drag || !surface) return;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    drag.overlay.remove();
    surface.querySelectorAll(".dry-html-reorder-drop-target").forEach((el) => el.classList.remove("dry-html-reorder-drop-target"));
    if (event?.type === "pointercancel") {
      surface.innerHTML = drag.initialHtml;
      this.drag = null;
      decorate(surface);
      return;
    }
    if (drag.location) {
      const parent = drag.placeholder.parentElement;
      const before = drag.placeholder.nextSibling;
      if (!parent) {
        drag.source.remove();
        this.drag = null;
        return;
      }
      drag.source.classList.remove("dry-html-reorder-dragging");
      drag.source.remove();
      drag.placeholder.remove();
      insertAt({ parent, before, target: drag.location.target }, drag.source);
      const html = cleanForCommit(surface);
      try {
        importCleanHtml(html);
      } catch {
        // Restore the complete pre-drag DOM. This also handles list-item
        // unwrapping, where the original source's children may have moved.
        surface.innerHTML = drag.initialHtml;
      }
    } else {
      drag.placeholder.remove();
      drag.source.classList.remove("dry-html-reorder-dragging");
    }
    this.drag = null;
    decorate(surface);
  };
}
