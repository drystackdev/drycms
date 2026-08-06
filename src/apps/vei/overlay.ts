import { decodeRefs, type DryRef } from "../../content-types/dry-vei-ref.js";
import {
  getAllEntryDraftRecords,
  subscribeEntryDraftChanges,
  type EntryDraftRecord,
} from "../../content-types/entry-draft-db.js";
import { encodeEntryId } from "../../lib/id-hash.js";
import { HYDRATED_EVENT } from "../hydrated-event.js";
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

/** Toggling edit mode round-trips through a real `/vei/enter`/`/vei/exit`
 * navigation (see `navigateWithSpinner`), which reloads the document from
 * scratch and would otherwise always land back at the top of the page.
 * `sessionStorage` carries the scroll offset across that reload - a query
 * param on `to` would work too, but would also leak into the URL bar and
 * survive a manual refresh, which this shouldn't. */
const SCROLL_STORAGE_KEY = "dry-vei-scroll";

function storeScrollPosition(): void {
  sessionStorage.setItem(
    SCROLL_STORAGE_KEY,
    JSON.stringify({ x: window.scrollX, y: window.scrollY }),
  );
}

/** Restores whatever `storeScrollPosition` saved before the enter/exit
 * navigation, then discards it - a stale value must not resurrect itself on
 * some later, unrelated reload. Applied twice: once immediately, and once
 * more on `load` in case images/fonts still loading at that point shift the
 * layout enough to make the first jump land short. */
function restoreScrollPosition(): void {
  const raw = sessionStorage.getItem(SCROLL_STORAGE_KEY);
  if (!raw) return;
  sessionStorage.removeItem(SCROLL_STORAGE_KEY);
  let position: { x: number; y: number };
  try {
    position = JSON.parse(raw) as { x: number; y: number };
  } catch {
    return;
  }
  const apply = () => window.scrollTo(position.x, position.y);
  apply();
  window.addEventListener("load", apply, { once: true });
}

/** `.sheet` is `position: fixed` over the whole viewport, but that alone
 * doesn't stop a wheel/touch scroll from chaining past it: the backdrop
 * itself has nothing to scroll, so the browser walks up to the next
 * scrollable ancestor, which is the host page's own `<html>`/`<body>` -
 * still scrolling the page visually hidden underneath. Locking overflow on
 * both while the sheet is open (and restoring whatever was there before,
 * rather than assuming it was empty) closes that gap. */
let lockedOverflow: { html: string; body: string } | null = null;

function lockBodyScroll(): void {
  if (lockedOverflow) return;
  lockedOverflow = {
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
  };
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll(): void {
  if (!lockedOverflow) return;
  document.documentElement.style.overflow = lockedOverflow.html;
  document.body.style.overflow = lockedOverflow.body;
  lockedOverflow = null;
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
function editorUrl(
  config: VeiConfig,
  target: EditTarget,
  fieldPath?: string,
): string {
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

/**
 * Opens `url` in a new FOREGROUND tab, from a handler that is itself running
 * on a Ctrl/Cmd+click.
 *
 * That combination is the whole difficulty. The browser decides where a new
 * tab goes from the modifiers on the INPUT EVENT IT IS CURRENTLY DISPATCHING
 * - not from how the open was spelled - so while the real Ctrl/Cmd+click is
 * still on the stack every route (`window.open`, a synthetic anchor click
 * carrying no modifiers of its own) yields a background tab, and `focus()` on
 * the opened window is ignored as focus-stealing. Deferring by one task is
 * what actually escapes it: no input event is in flight by then, while the
 * page still holds the transient user activation (good for ~5s) that keeps
 * the open from being treated as an unsolicited popup.
 */
function openInNewTab(url: string): void {
  setTimeout(() => {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
  }, 0);
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
function applyPreview(detail: {
  name: string;
  value: unknown;
  typeSlug: string;
  entryId: string | null;
}): void {
  for (const node of document.querySelectorAll("*")) {
    for (const attribute of node.getAttributeNames()) {
      if (attribute !== "data-dry" && !attribute.startsWith("data-dry-"))
        continue;
      for (const ref of decodeRefs(node.getAttribute(attribute))) {
        if (ref.type !== detail.typeSlug) continue;
        // A singleton's editor has no entry id of its own, so the type name
        // alone identifies it - matching `draftKey`'s own convention.
        if (detail.entryId !== null && encodeEntryId(ref.id) !== detail.entryId)
          continue;
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
      if (attribute !== "data-dry" && !attribute.startsWith("data-dry-"))
        continue;
      for (const ref of decodeRefs(node.getAttribute(attribute))) {
        targets.set(`${ref.type}:${ref.id}`, {
          kind: ref.kind,
          type: ref.type,
          id: ref.id,
        });
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
  // Runs before either early-return below: a toggle can round-trip through
  // either state (turning edit mode on OR off both go through
  // navigateWithSpinner), so whichever page comes back has to check.
  restoreScrollPosition();

  const config = readConfig();
  if (!config) return;
  if (!config.edit && !hasAdminHint()) return;

  const host = document.createElement("div");
  host.id = "dry-vei-overlay";
  const root = host.attachShadow({ mode: "open" });
  root.append(element("style", { textContent: OVERLAY_STYLES }));
  // Everything else renders inside this wrapper rather than directly under
  // the shadow root: `overlay-styles.ts` shares the real admin palette
  // (`styles/tokens.css`, imported raw rather than hand-copied) by inlining
  // it verbatim, and its rules are scoped to `.dry` exactly like the admin
  // bundle itself scopes them - `scope` is the one element inside this
  // shadow tree that actually carries that class for them to match.
  const scope = element("div", { className: "dry" });
  root.append(scope);
  document.body.append(host);

  /**
   * `/vei/enter`/`/vei/exit` are real navigations (a cookie only takes effect
   * through a genuine `Set-Cookie` round trip, and the markers this whole
   * overlay depends on only exist in a fresh server render - see
   * `status/vei.md`'s writeup of why this can't be done client-side). That
   * round trip isn't instant, so swapping the clicked button to a spinner
   * BEFORE kicking off the navigation gives it something to show for that
   * gap instead of just sitting there until the browser starts unloading -
   * same idea as `setSaving()` below, just for a real page transition
   * instead of `saveAll()`'s own async work.
   */
  function navigateWithSpinner(
    button: HTMLButtonElement,
    label: string,
    url: string,
  ): void {
    storeScrollPosition();
    button.disabled = true;
    button.replaceChildren(
      element("span", { className: "vei-spinner" }),
      document.createTextNode(label),
    );
    window.location.href = url;
  }

  if (!config.edit) {
    const button = element("button", {
      type: "button",
      textContent: "Edit content",
    });
    button.addEventListener("click", () =>
      navigateWithSpinner(
        button,
        "Opening editor",
        `${config.path}/vei/enter?to=${encodeURIComponent(currentLocation())}`,
      ),
    );
    scope.append(element("div", { className: "dock" }, [button]));
    return;
  }

  document.head.append(element("style", { textContent: MARKER_STYLES }));
  document.documentElement.classList.add(EDITING_CLASS);

  const exitButton = element("button", {
    type: "button",
    className: "ghost",
    textContent: "Exit",
  });
  exitButton.addEventListener("click", () =>
    navigateWithSpinner(
      exitButton,
      "Exiting",
      `${config.path}/vei/exit?to=${encodeURIComponent(currentLocation())}`,
    ),
  );
  const previewCount = element("span", { className: "badge sm secondary" });
  const previewButton = element(
    "button",
    { type: "button", className: "ghost" },
    [document.createTextNode("Preview all"), previewCount],
  );
  const saveButton = element("button", { type: "button" }, [
    document.createTextNode("Save"),
  ]);
  const status = element("span", {
    className: "label",
    textContent: "Edit mode",
  });
  const dock = element("div", { className: "dock" }, [
    status,
    previewButton,
    saveButton,
    exitButton,
  ]);
  scope.append(dock);

  /**
   * Runs `mutate` (a status-text or Save-button content change) and animates
   * the dock's width between its size before and after, instead of the box
   * snapping to its new size instantly. CSS alone can't do this - a
   * `transition` on `width` never animates to/from "auto" (the dock's
   * resting state, sized by its content), so this measures a real pixel
   * value on both sides and lets the CSS transition (`.dock`'s own,
   * `overlay-styles.ts`) interpolate between them.
   *
   * The `requestAnimationFrame` mirrors `Toast.tsx`'s own `mounted` dance
   * for the identical reason its comment gives: the "before" width has to
   * actually commit to a rendered frame before setting the "after" width
   * counts as a change to transition FROM, rather than both writes
   * collapsing into one with nothing to animate.
   *
   * The "after" width is measured with the explicit width released back to
   * "auto" rather than read straight off `scrollWidth` - `scrollWidth` on an
   * element that's still pinned to `before`px can only ever report a value
   * >= that (it measures overflow past the current box, not the content's
   * own natural size), so it correctly grows a mutation that adds content
   * but can't shrink one that removes it (e.g. "Preview all" going
   * `display: none` entirely, not just its badge). "auto" always yields the
   * true content-fit size in either direction.
   */
  function animateDockWidth(mutate: () => void): void {
    const before = dock.getBoundingClientRect().width;
    dock.style.width = `${before}px`;
    mutate();
    dock.style.width = "auto";
    const after = dock.getBoundingClientRect().width;
    dock.style.width = `${before}px`;
    requestAnimationFrame(() => {
      dock.style.width = `${after}px`;
    });
  }

  function setStatus(text: string): void {
    animateDockWidth(() => {
      status.textContent = text;
    });
  }

  /** Toggles the Save button between its idle label and a spinner + "Saving"
   * while `saveAll()` runs - `status` already carries the granular
   * per-entry progress, this is just the button's own busy affordance. */
  function setSaving(saving: boolean): void {
    animateDockWidth(() => {
      saveButton.disabled = saving;
      saveButton.replaceChildren(
        ...(saving
          ? [
              element("span", { className: "vei-spinner" }),
              document.createTextNode("Saving"),
            ]
          : [document.createTextNode("Save")]),
      );
    });
  }

  /** The dock's "Preview all" badge - every distinct entry/singleton with a
   * pending draft ANYWHERE on the site, not just this page (unlike
   * `pendingTargets()` below, which `saveAll()` deliberately scopes to what
   * this page marks). Reads IndexedDB directly rather than diffing each
   * draft against its server value (what `pages/vei/ChangesPreview.tsx`
   * itself does) - that's a network round trip per entry, too heavy to redo
   * on every keystroke just for a badge count. */
  async function refreshPreviewCount(): Promise<void> {
    const records = await getAllEntryDraftRecords();
    animateDockWidth(() => {
      previewCount.textContent = String(records.length);
      // Nothing to preview yet - the whole button goes away rather than
      // sitting there disabled or pointing at an empty page.
      previewButton.style.display = records.length > 0 ? "" : "none";
    });
  }
  void refreshPreviewCount();

  /**
   * `hydrate-client.ts` reconciles the page's DOM against its own (server-
   * replayed, so still last-saved) vnode tree - any DOM edit made before
   * that finishes gets silently overwritten the instant it does, since a
   * mismatched text node is exactly what hydration "fixes". Its `main()` is
   * async (`resolveMatchToVNode` route-splits), so this really can lose the
   * race: `applyPendingDrafts` below reads IndexedDB and mutates the DOM
   * well before hydration's dynamic import resolves. `HYDRATED_EVENT` fires
   * once hydration is done either way (`hydrated-event.ts`), including on a
   * 404 where hydration never runs at all - checking `dryHydrated` first
   * covers the (normal, non-404) case where it already fired before this
   * module's own script tag even started executing.
   */
  function whenHydrated(): Promise<void> {
    if ((window as { dryHydrated?: boolean }).dryHydrated) return Promise.resolve();
    return new Promise((resolve) => {
      window.addEventListener(HYDRATED_EVENT, () => resolve(), { once: true });
    });
  }

  /**
   * Reapplies whatever drafts are already sitting in IndexedDB as soon as
   * the page loads - without this, a plain reload (anything other than
   * `saveAll()`'s own `window.location.reload()` after a real save) silently
   * drops every unsaved edit's preview back to the last-saved server value,
   * even though the draft that produced it is still right there. Same
   * `applyPreview` the live `vei:input` bridge message uses; the only
   * difference is the source is IndexedDB instead of a postMessage.
   */
  /** One target's draft, every top-level field - shared by `applyPendingDrafts`
   * (looping every marked target on load) and the cross-tab subscription
   * below (one target at a time, as each remote change arrives). */
  function applyDraftRecord(target: EditTarget, draft: EntryDraftRecord): void {
    const entryId = target.kind === "singleton" ? null : encodeEntryId(target.id);
    for (const [name, value] of Object.entries(draft.value)) {
      applyPreview({ name, value, typeSlug: target.type, entryId });
    }
  }

  async function applyPendingDrafts(): Promise<void> {
    await whenHydrated();
    const drafts = await getAllEntryDraftRecords().catch(() => []);
    if (drafts.length === 0) return;
    const draftsByKey = new Map(drafts.map((draft) => [draft.key, draft]));
    for (const target of markedTargets()) {
      const draft = draftsByKey.get(draftKeyFor(target));
      if (draft) applyDraftRecord(target, draft);
    }
  }
  void applyPendingDrafts();

  /**
   * Cross-tab live preview: a draft written or discarded in a DIFFERENT tab
   * - another tab open on this same page, or the entry's own admin editor -
   * reaches this page immediately via `BroadcastChannel`
   * (`entry-draft-db.ts`'s `subscribeEntryDraftChanges`), instead of this
   * page only catching up on its own next reload. A "put" patches the DOM
   * exactly like a live `vei:input` bridge message does (`applyDraftRecord`,
   * same helper `applyPendingDrafts` uses on load). A "delete" (the draft
   * was saved or discarded elsewhere) reloads instead of trying to patch
   * backwards - this overlay never keeps the pre-preview original value
   * around to revert a marked node to, only what a draft says to show.
   * Never torn down: this overlay runs for the page's whole lifetime (an
   * MPA - there's no unmount to clean it up on), same as every other
   * `window.addEventListener` in this file.
   */
  subscribeEntryDraftChanges((message) => {
    void refreshPreviewCount();
    const targets = markedTargets();
    if (message.type === "put") {
      const target = targets.find((candidate) => draftKeyFor(candidate) === message.record.key);
      if (target) applyDraftRecord(target, message.record);
    } else if (targets.some((candidate) => draftKeyFor(candidate) === message.key)) {
      window.location.reload();
    }
  });

  // A field's debounced IndexedDB write (`saveEntryDraft`'s 300ms) lags the
  // `vei:input` message that triggers this, so the badge is deliberately
  // read back after it - and coalesced into one timer per burst of keystrokes
  // rather than one refresh per keystroke.
  let previewCountTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePreviewCountRefresh(): void {
    clearTimeout(previewCountTimer);
    previewCountTimer = setTimeout(() => void refreshPreviewCount(), 400);
  }

  /**
   * The hover highlight around whatever marked field is under the pointer -
   * a `position: fixed` box (`.field-highlight`, `overlay-styles.ts`) that
   * this shadow host's own JS positions from `getBoundingClientRect()`,
   * replacing the old CSS `:hover { outline }` on the field itself. An
   * outline inherits the field's own stacking context and clipping - a
   * field inside an `overflow: hidden` carousel/panel, or sitting behind a
   * higher z-index sibling, would have it clipped or covered. This box is a
   * sibling of the whole page (appended straight to `<body>`, same as
   * `.dock`) instead, so neither problem applies.
   */
  const highlight = element("div", { className: "field-highlight" });
  scope.append(highlight);
  let hoveredElement: Element | null = null;

  /**
   * A dashed outline says "this is editable" but nothing says HOW, and the
   * Ctrl/Cmd+click gesture in particular is invisible until someone guesses
   * it. So the hovered field carries a plain native `title` spelling both
   * out - it can't live on `.field-highlight` (that box is
   * `pointer-events: none`, and lives in the shadow root besides), it has to
   * be on the site's own element.
   *
   * Applied per hover rather than stamped on every marked element up front,
   * because the element may already HAVE a title of its own (a link hint, an
   * abbreviation) that has to come back the moment the pointer leaves.
   */
  // The gesture's name differs by platform, and so must the hint - `⌘` on
  // Apple, `Ctrl` everywhere else. `userAgentData.platform` ("macOS") is the
  // non-deprecated source where it exists; the UA string is the fallback for
  // Safari/Firefox, which don't implement it.
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ?? navigator.userAgent;
  const EDIT_HINT = `Click to edit · ${
    /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl"
  }+click to open the full editor in a new tab · Shift+click to run it normally`;
  let hintedTitle: string | null = null;

  function applyHint(el: Element): void {
    hintedTitle = el.getAttribute("title");
    el.setAttribute("title", EDIT_HINT);
  }

  function clearHint(): void {
    if (!hoveredElement) return;
    if (hintedTitle === null) hoveredElement.removeAttribute("title");
    else hoveredElement.setAttribute("title", hintedTitle);
    hintedTitle = null;
  }

  function positionHighlight(el: Element): void {
    const rect = el.getBoundingClientRect();
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.style.display = "block";
    highlight.style.borderRadius = getComputedStyle(el).borderRadius;
  }

  function hideHighlight(): void {
    clearHint();
    hoveredElement = null;
    highlight.style.display = "none";
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (sheet.isConnected) return;
      const marked = markedElementFor(event);
      if (!marked) {
        hideHighlight();
        return;
      }
      if (marked !== hoveredElement) {
        clearHint();
        applyHint(marked);
      }
      hoveredElement = marked;
      positionHighlight(marked);
    },
    true,
  );

  // The pointer doesn't have to move for the highlighted rect to go stale -
  // the page underneath can scroll (capture phase still sees this even from
  // a nested scroll container, even though `scroll` itself doesn't bubble)
  // while hovering the same element. Rather than re-measuring on every
  // scroll tick, just hide it - the next `mousemove` (scrolling never fires
  // one on its own) re-marks whatever ends up under the pointer anyway.
  document.addEventListener(
    "scroll",
    () => {
      if (hoveredElement) hideHighlight();
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (hoveredElement) positionHighlight(hoveredElement);
  });

  const agent = element("iframe", { className: "agent" });
  scope.append(agent);

  /**
   * Replays one entry through the REAL editor: point the hidden frame at
   * that entry's admin route, wait for its bridge to announce itself, ask it
   * to Save, and wait for the outcome. Nothing here knows how saving works -
   * validation, draft cleanup and error reporting stay in
   * `ContentEntryEditor`, which is the point (`plans/vei.md`'s "Save flow").
   */
  function saveTarget(target: EditTarget): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        resolve(ok);
      };
      const onMessage = (event: MessageEvent) => {
        if (
          event.origin !== window.location.origin ||
          event.source !== agent.contentWindow
        )
          return;
        const message = event.data as { type?: string; ok?: boolean } | null;
        if (message?.type === "vei:ready")
          agent.contentWindow?.postMessage(
            { type: "vei:save" },
            window.location.origin,
          );
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
      setStatus("No changes to save");
      return;
    }
    setSaving(true);
    let failed = 0;
    for (const [index, target] of targets.entries()) {
      setStatus(`Saving ${target.type} (${index + 1}/${targets.length})`);
      if (!(await saveTarget(target))) failed += 1;
    }
    if (failed > 0) {
      setStatus(`${failed}/${targets.length} entries failed to save`);
      setSaving(false);
      // The entries that DID succeed had their drafts discarded already
      // (inside `ContentEntryEditor`'s own `handleSave`) - only the reload
      // path below skips this because it's about to throw the whole badge
      // away anyway.
      void refreshPreviewCount();
      return;
    }
    // The page has to come back from the server: `pages-cache` has already
    // expired itself (every touched type's `getResourceVersion` moved), and
    // the preview patches are DOM-only.
    window.location.reload();
  }

  saveButton.addEventListener("click", () => void saveAll());

  // No close control of its own beyond the backdrop/Escape below - a title
  // or a Cancel button here would duplicate what the admin page framed
  // inside `frame` already shows (its own `<h1>`, and a Cancel button next
  // to Preview - see `ContentEntryEditor.tsx`, which reaches `closeDialog`
  // below via `postMessage` through `pages/vei/bridge.ts`).
  const sheet = element("div", { className: "sheet" });
  const frame = element("iframe");
  const panelLoading = element("div", { className: "panel-loading" }, [
    element("span", { className: "vei-spinner lg" }),
  ]);
  const panel = element("div", { className: "panel" }, [frame, panelLoading]);
  sheet.append(panel);
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) closeDialog();
  });

  let dialogLoadTimer: ReturnType<typeof setTimeout> | undefined;

  /** Opens the dialog on an arbitrary admin URL - the one field-edit dialog
   * this overlay otherwise only ever points at one entry's editor
   * (`openDialog` below), but "Preview all" has no single entry to aim at. */
  function openFrame(url: string): void {
    hideHighlight();
    lockBodyScroll();
    panel.classList.add("loading");
    frame.src = url;
    scope.append(sheet);
    // The panel-loading spinner covers the iframe until its bridge announces
    // `vei:ready` (below) - a frame that never gets that far (a stalled
    // request, an unexpected redirect out of the SPA) must not leave it
    // spinning forever, so this reveals whatever the frame DID load anyway.
    clearTimeout(dialogLoadTimer);
    dialogLoadTimer = setTimeout(
      () => panel.classList.remove("loading"),
      15000,
    );
  }

  function openDialog(ref: DryRef): void {
    openFrame(editorUrl(config as VeiConfig, ref, ref.path));
  }

  previewButton.addEventListener("click", () =>
    openFrame(`${config.path}/vei/changes?_vei=1`),
  );

  function closeDialog(): void {
    clearTimeout(dialogLoadTimer);
    unlockBodyScroll();
    sheet.remove();
    frame.removeAttribute("src");
    // Whatever ran in that frame - an edit, a Reset all from its own Preview
    // dialog, a visit to `/vei/changes` itself - may have changed the set of
    // pending drafts, so the badge could be stale the moment this closes.
    void refreshPreviewCount();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet.isConnected) closeDialog();
  });

  // Same-origin by construction (the iframe is an admin route on this very
  // site), so anything from another origin - or from a window that isn't
  // our dialog - is not ours to act on.
  window.addEventListener("message", (event) => {
    if (
      event.origin !== window.location.origin ||
      event.source !== frame.contentWindow
    )
      return;
    const message = event.data as {
      type?: string;
      detail?: Parameters<typeof applyPreview>[0];
    };
    if (message?.type === "vei:ready") {
      clearTimeout(dialogLoadTimer);
      panel.classList.remove("loading");
    } else if (message?.type === "vei:input" && message.detail) {
      applyPreview(message.detail);
      schedulePreviewCountRefresh();
    }
    // Escape pressed with focus inside the frame never reaches this
    // document's own keydown listener - the bridge forwards it.
    else if (message?.type === "vei:close") closeDialog();
  });

  // Capture phase, and both events: a marked element is very often inside a
  // link or a button, and letting that default action run would navigate
  // away mid-edit.
  const intercept = (event: MouseEvent) => {
    // Only ever guards a REAL user gesture - the synthetic click replayed
    // below (Shift+click) must never re-enter this same listener.
    if (!event.isTrusted) return;
    if (sheet.isConnected) return;
    const marked = markedElementFor(event);
    if (!marked) return;
    if (event.shiftKey) {
      // Shift+click is the escape hatch back to the page's OWN behavior, but
      // the browser's native modifier semantics for a link get in the way:
      // Shift+click on an `<a>` normally opens it in a whole NEW window
      // (unlike Ctrl/Cmd, which opens a background TAB) - exactly what
      // nobody wants when the point is "run it right here". So the
      // shift-flagged original is cancelled and replaced with a plain,
      // unmodified click: `.click()` on the nearest linked ancestor re-runs
      // real navigation in THIS tab; anything else (a marked element's own
      // `onClick`) just gets a plain click dispatched at it.
      if (event.type === "click") {
        event.preventDefault();
        event.stopPropagation();
        const anchor = marked.closest("a");
        if (anchor?.href) anchor.click();
        else marked.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "click") return;
    const ref = refsOn(marked)[0]!;
    // Ctrl/Cmd+click is the browser's native "open elsewhere" gesture - here
    // that means the field's own admin editor page, in a new tab, instead
    // of the inline dialog a plain click opens.
    if (event.ctrlKey || event.metaKey) {
      openInNewTab(editorUrl(config as VeiConfig, ref, ref.path));
    } else {
      openDialog(ref);
    }
  };
  document.addEventListener("mousedown", intercept, true);
  document.addEventListener("click", intercept, true);
}

main();
