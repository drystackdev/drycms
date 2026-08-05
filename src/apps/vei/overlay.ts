import { decodeRefs, type DryRef } from "../../content-types/dry-vei-ref.js";
import { getAllEntryDraftRecords } from "../../content-types/entry-draft-db.js";
import { encodeEntryId } from "../../lib/id-hash.js";
import { MARKER_STYLES, OVERLAY_STYLES } from "./overlay-styles.js";

/**
 * Visual Editing Interface, browser half (see `plans/vei.md`). Loaded by
 * `render.ts` on every App Router page, so the first thing it does is
 * decide whether it has any business running at all: an anonymous visitor
 * has no `drycms_admin` hint cookie and this returns before touching the
 * DOM. Nothing here can grant access - `page-handler.ts` already decided
 * that server-side, and the markers this reads only exist in a render it
 * authorized.
 */
interface VeiConfig {
  /** The admin's base path (`dry.config.ts`'s `path`) - the site bundle has
   * no other way to know it. */
  path: string;
  /** Whether THIS render carries markers (i.e. a valid `drycms_vei`
   * cookie). A cached page never does. */
  edit: boolean;
}

const CONFIG_ELEMENT_ID = "dry-vei-config";
const HINT_COOKIE = "drycms_admin=1";
const EDITING_CLASS = "dry-vei-editing";

function readConfig(): VeiConfig | null {
  const element = document.getElementById(CONFIG_ELEMENT_ID);
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as VeiConfig;
  } catch {
    return null;
  }
}

function hasAdminHint(): boolean {
  return document.cookie.split(";").some((part) => part.trim() === HINT_COOKIE);
}

function currentLocation(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Every marker on one element, across the text marker and the
 * attribute-scoped ones (`data-dry-src`, `data-dry-html`). */
function refsOn(element: Element): DryRef[] {
  const refs: DryRef[] = [];
  for (const name of element.getAttributeNames()) {
    if (name === "data-dry" || name.startsWith("data-dry-")) {
      refs.push(...decodeRefs(element.getAttribute(name)));
    }
  }
  return refs;
}

/** The innermost marked element under the pointer. `composedPath` rather
 * than `event.target` so a click landing inside a web component's shadow
 * tree (RichText renders components that way) still finds the marked host
 * above it. */
function markedElementFor(event: Event): Element | null {
  for (const node of event.composedPath()) {
    if (node instanceof Element && refsOn(node).length > 0) return node;
  }
  return null;
}

/**
 * The admin URL that edits one field. Not a bespoke route: this is the
 * ordinary entry editor, with `?_field=` (a deep link it already supports)
 * aimed at the field that was clicked. A singleton has no id of its own -
 * `${path}/content/<name>` is its editor URL, and `ContentEntryList`
 * forwards that route to the editor.
 */
function editorUrl(config: VeiConfig, target: EditTarget, fieldPath?: string): string {
  // The admin addresses an entry by its OBFUSCATED id (`id-hash.ts`), while
  // a ref carries the real row id the reader returned - `/content/blog/38`
  // is a 404, `/content/blog/3nWuyG` is the same row.
  const base =
    target.kind === "singleton"
      ? `${config.path}/content/${target.type}`
      : `${config.path}/content/${target.type}/${encodeEntryId(target.id)}`;
  const params = new URLSearchParams({ _vei: "1" });
  if (fieldPath) {
    params.set("_field", fieldPath.split(".")[0] ?? fieldPath);
    // The full path only matters when it reaches inside a component; sending
    // it always would just be noise in the URL.
    if (fieldPath.includes(".")) params.set("_path", fieldPath);
  }
  return `${base}?${params.toString()}`;
}

/** Walks `value` down the part of `ref.path` below `fromField`. The editor
 * reports changes per TOP-LEVEL field, so a change to `hero.name` arrives as
 * the whole `hero` component object and the rest of the path has to be
 * resolved here. A numeric segment indexes a repeatable item's array, the
 * same shape `field-path.ts`'s `setValueAtPath` writes through. */
function valueAtPath(value: unknown, path: string, fromField: string): unknown {
  const segments = path.split(".");
  if (segments[0] !== fromField) return undefined;
  let current = value;
  for (const segment of segments.slice(1)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Applies one in-flight edit straight to the DOM - the whole of "preview"
 * (`plans/vei.md`'s decision #6). Cheap because the markers already say
 * which node owns which field. It does mean the DOM and Preact's vnode tree
 * diverge, which is fine for a page that never re-renders after hydration:
 * this is an MPA, and edit mode adds no client router.
 */
function applyPreview(detail: { name: string; value: unknown; typeSlug: string; entryId: string | null }): void {
  for (const node of document.querySelectorAll("*")) {
    for (const attribute of node.getAttributeNames()) {
      if (attribute !== "data-dry" && !attribute.startsWith("data-dry-")) continue;
      for (const ref of decodeRefs(node.getAttribute(attribute))) {
        if (ref.type !== detail.typeSlug) continue;
        // A singleton's editor has no entry id of its own, so the type name
        // alone identifies it - matching `draftKey`'s own convention.
        if (detail.entryId !== null && encodeEntryId(ref.id) !== detail.entryId) continue;
        const next = valueAtPath(detail.value, ref.path, detail.name);
        if (next === undefined) continue;
        const target = attribute.slice("data-dry-".length);
        if (attribute === "data-dry") node.textContent = String(next);
        else if (target === "html") node.innerHTML = String(next);
        else node.setAttribute(target, String(next));
      }
    }
  }
}

interface EditTarget {
  kind: DryRef["kind"];
  type: string;
  id: number;
}

/** Every distinct entry the current page renders a marker for. Scoping
 * "Save" to these - rather than to every draft in IndexedDB - keeps it from
 * publishing an unrelated draft the admin left half-written in a tab
 * somewhere, and matches what the button appears to promise: save what you
 * just edited HERE. */
function markedTargets(): EditTarget[] {
  const targets = new Map<string, EditTarget>();
  for (const node of document.querySelectorAll("*")) {
    for (const attribute of node.getAttributeNames()) {
      if (attribute !== "data-dry" && !attribute.startsWith("data-dry-")) continue;
      for (const ref of decodeRefs(node.getAttribute(attribute))) {
        targets.set(`${ref.type}:${ref.id}`, { kind: ref.kind, type: ref.type, id: ref.id });
      }
    }
  }
  return [...targets.values()];
}

/** The editor's own draft key for a target - `entry-draft-store.ts`'s
 * `draftKey`, which a singleton keys as `__new__` because it has no entry
 * id of its own. Not imported from there: that module pulls in
 * `@preact/signals` for the admin's draft badge, which has no business in
 * the public site's bundle. */
function draftKeyFor(target: EditTarget): string {
  return `${target.type}:${target.kind === "singleton" ? "__new__" : encodeEntryId(target.id)}`;
}

async function pendingTargets(): Promise<EditTarget[]> {
  const drafts = await getAllEntryDraftRecords().catch(() => []);
  const keys = new Set(drafts.map((draft) => draft.key));
  return markedTargets().filter((target) => keys.has(draftKeyFor(target)));
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function main(): void {
  const config = readConfig();
  if (!config) return;
  if (!config.edit && !hasAdminHint()) return;

  const host = document.createElement("div");
  host.id = "dry-vei-overlay";
  const root = host.attachShadow({ mode: "open" });
  root.append(element("style", { textContent: OVERLAY_STYLES }));
  document.body.append(host);

  const enter = () => {
    window.location.href = `${config.path}/vei/enter?to=${encodeURIComponent(currentLocation())}`;
  };
  const exit = () => {
    window.location.href = `${config.path}/vei/exit?to=${encodeURIComponent(currentLocation())}`;
  };

  if (!config.edit) {
    const button = element("button", { type: "button", textContent: "Sửa nội dung" });
    button.addEventListener("click", enter);
    root.append(element("div", { className: "dock" }, [button]));
    return;
  }

  document.head.append(element("style", { textContent: MARKER_STYLES }));
  document.documentElement.classList.add(EDITING_CLASS);

  const exitButton = element("button", { type: "button", className: "ghost", textContent: "Thoát" });
  exitButton.addEventListener("click", exit);
  const saveButton = element("button", { type: "button", textContent: "Lưu" });
  const status = element("span", { className: "label", textContent: "Đang sửa nội dung" });
  root.append(element("div", { className: "dock" }, [status, saveButton, exitButton]));

  const agent = element("iframe", { className: "agent" });
  root.append(agent);

  /**
   * Replays one entry through the REAL editor: point the hidden frame at
   * that entry's admin route, wait for its bridge to announce itself, ask it
   * to Save, and wait for the outcome. Nothing here knows how saving works -
   * validation, draft cleanup and error reporting stay in
   * `ContentEntryEditor`, which is the point (`plans/vei.md`'s "Luồng Save").
   */
  function saveTarget(target: EditTarget): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        resolve(ok);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== agent.contentWindow) return;
        const message = event.data as { type?: string; ok?: boolean } | null;
        if (message?.type === "vei:ready") agent.contentWindow?.postMessage({ type: "vei:save" }, window.location.origin);
        else if (message?.type === "vei:saved") done(message.ok === true);
      };
      // A frame that never reports back (a load failure, a session that
      // expired mid-session) must not hang the whole run.
      const timer = setTimeout(() => done(false), 30000);
      window.addEventListener("message", onMessage);
      agent.src = editorUrl(config as VeiConfig, target);
    });
  }

  async function saveAll(): Promise<void> {
    const targets = await pendingTargets();
    if (targets.length === 0) {
      status.textContent = "Không có thay đổi nào";
      return;
    }
    saveButton.disabled = true;
    let failed = 0;
    for (const [index, target] of targets.entries()) {
      status.textContent = `Đang lưu ${target.type} (${index + 1}/${targets.length})`;
      if (!(await saveTarget(target))) failed += 1;
    }
    if (failed > 0) {
      status.textContent = `${failed}/${targets.length} mục lưu không thành công`;
      saveButton.disabled = false;
      return;
    }
    // The page has to come back from the server: `pages-cache` has already
    // expired itself (every touched type's `getResourceVersion` moved), and
    // the preview patches are DOM-only.
    window.location.reload();
  }

  saveButton.addEventListener("click", () => void saveAll());

  const sheet = element("div", { className: "sheet" });
  const frame = element("iframe");
  const closeButton = element("button", { type: "button", className: "close", textContent: "×", title: "Đóng" });
  sheet.append(element("div", { className: "panel" }, [frame, closeButton]));
  closeButton.addEventListener("click", () => closeDialog());
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) closeDialog();
  });

  function openDialog(ref: DryRef): void {
    frame.src = editorUrl(config as VeiConfig, ref, ref.path);
    root.append(sheet);
  }

  function closeDialog(): void {
    sheet.remove();
    frame.removeAttribute("src");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet.isConnected) closeDialog();
  });

  // Same-origin by construction (the iframe is an admin route on this very
  // site), so anything from another origin - or from a window that isn't
  // our dialog - is not ours to act on.
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    const message = event.data as { type?: string; detail?: Parameters<typeof applyPreview>[0] };
    if (message?.type === "vei:input" && message.detail) applyPreview(message.detail);
    // Escape pressed with focus inside the frame never reaches this
    // document's own keydown listener - the bridge forwards it.
    else if (message?.type === "vei:close") closeDialog();
  });

  // Capture phase, and both events: a marked element is very often inside a
  // link or a button, and letting that default action run would navigate
  // away mid-edit.
  const intercept = (event: MouseEvent) => {
    if (sheet.isConnected) return;
    const marked = markedElementFor(event);
    if (!marked) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "click") openDialog(refsOn(marked)[0]!);
  };
  document.addEventListener("mousedown", intercept, true);
  document.addEventListener("click", intercept, true);
}

main();
