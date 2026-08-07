import { h, render } from "preact";
import { decodeRefs, type DryRef } from "../../content-types/dry-vei-ref.js";
import {
  getAllEntryDraftRecords,
  subscribeEntryDraftChanges,
  type EntryDraftRecord,
} from "../../content-types/entry-draft-db.js";
import { encodeEntryId } from "../../lib/id-hash.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import { HYDRATED_EVENT } from "../hydrated-event.js";
import { EditButtonDock, EditingDock, type EditingDockHandle, type EditorMode } from "./Dock.js";
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

/** The field editor's dialog-vs-panel choice (`Dock.tsx`'s `ModeToggle`) -
 * `localStorage`, not `sessionStorage`, so it's a real standing preference
 * rather than something a scroll-position-style enter/exit round trip would
 * reset. A dedicated key, not the admin's shared `drycms:store`
 * (`src/hooks/useStore.tsx`) - that's an admin-app concern this public-site
 * file has no business pulling in, same reasoning `draftKeyFor`'s doc
 * comment gives for skipping `entry-draft-store.ts`. */
const MODE_STORAGE_KEY = "dry-vei-mode";

function readStoredMode(): EditorMode {
  return localStorage.getItem(MODE_STORAGE_KEY) === "panel" ? "panel" : "dialog";
}

/**
 * Mirrors `lib/native/theme.ts`'s `readStoredTheme`/`applyTheme` - not
 * imported from there, since that module also wires up a global
 * `[data-theme-toggle]` click delegation, an admin-page concern this
 * public-site file has no business pulling in (same reasoning
 * `draftKeyFor`'s doc comment gives for skipping `entry-draft-store.ts`).
 * Without this, the overlay's own `.dry` scope only ever follows OS
 * `prefers-color-scheme` (`light-dark()`, `tokens.css`), diverging from an
 * admin who has explicitly pinned light or dark rather than "system" - the
 * dock/backdrop/panel chrome would show one theme while the entry editor
 * framed inside them (a real `/dry` page, themed by that same script) shows
 * another.
 */
const THEME_STORAGE_KEY = "drycms:store";

function currentTheme(): "light" | "dark" | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    const value = raw ? (JSON.parse(raw) as { theme?: unknown }).theme : undefined;
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyOverlayTheme(scope: HTMLElement): void {
  scope.classList.remove("light", "dark");
  const theme = currentTheme();
  if (theme) scope.classList.add(theme);
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
 * What the marked ATTRIBUTE should hold for a new field value. Only `image`
 * needs the translation: it stores a bare storage id ("hero.jpg"), and the
 * page put it in `src` through `resolveImageSrc` - writing the raw draft
 * value back would resolve it relative to the current page
 * (`/blogs/<slug>/hero.jpg`) and 404. Every other boxable field type already
 * IS what the attribute holds.
 */
function attributeValue(ref: DryRef, value: unknown, basePath: string): string {
  const text = value === null ? "" : String(value);
  // A cleared image is the one case with nothing to resolve - `resolveImageSrc("")`
  // would build a `/api/storage/` URL pointing at no file at all.
  if (ref.fieldType !== "image" || text === "") return text;
  return resolveImageSrc(text, basePath);
}

/**
 * Applies one in-flight edit straight to the DOM - the whole of "preview"
 * (`plans/vei.md`'s decision #6). Cheap because the markers already say
 * which node owns which field. It does mean the DOM and Preact's vnode tree
 * diverge, which is fine for a page that never re-renders after hydration:
 * this is an MPA, and edit mode adds no client router.
 */
function applyPreview(
  detail: {
    name: string;
    value: unknown;
    typeSlug: string;
    entryId: string | null;
  },
  basePath: string,
): void {
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
        else node.setAttribute(target, attributeValue(ref, next, basePath));
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
  // Read out once so the closures below don't each have to re-narrow `config`
  // (which is why the rest of this function says `config as VeiConfig`).
  const basePath = config.path;

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
  applyOverlayTheme(scope);
  root.append(scope);
  document.body.append(host);

  // The entry editor's own ThemeToggle runs inside `frame`/`agent` - a
  // DIFFERENT window from this one, even though it's visually nested here -
  // so its write to this same `localStorage` key fires a `storage` event on
  // THIS window rather than updating anything here directly (`storage`
  // never fires on the document that made the change, only other same-
  // origin ones). Re-applying on it keeps the overlay's own chrome in sync
  // with a theme change made from inside the panel/dialog while it's open.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) applyOverlayTheme(scope);
  });

  /**
   * `/vei/enter`/`/vei/exit` are real navigations (a cookie only takes effect
   * through a genuine `Set-Cookie` round trip, and the markers this whole
   * overlay depends on only exist in a fresh server render - see
   * `status/vei.md`'s writeup of why this can't be done client-side). That
   * round trip isn't instant, so the dock switches whichever button was
   * clicked to a spinner (`Dock.tsx`'s own local state) BEFORE this runs -
   * deferred by one task so that Preact re-render actually gets a paint in
   * before the browser starts tearing the page down for the new navigation,
   * the same reasoning `openInNewTab` above uses a `setTimeout` for.
   */
  function navigateTo(url: string): void {
    storeScrollPosition();
    setTimeout(() => {
      window.location.href = url;
    }, 0);
  }

  if (!config.edit) {
    render(
      h(EditButtonDock, {
        onOpenEditor: () =>
          navigateTo(`${config.path}/vei/enter?to=${encodeURIComponent(currentLocation())}`),
      }),
      scope,
    );
    return;
  }

  document.head.append(element("style", { textContent: MARKER_STYLES }));
  document.documentElement.classList.add(EDITING_CLASS);

  // The dialog/panel choice - read once at boot, updated only by the dock's
  // own toggle. Kept as a plain outer variable (not Preact state) because
  // `openFrame`/the resize handle below are vanilla DOM and need to read the
  // CURRENT value at click/drag time, not be re-rendered when it changes.
  let mode: EditorMode = readStoredMode();

  let dock!: EditingDockHandle;
  render(
    h(EditingDock, {
      initialMode: mode,
      onModeChange: (next) => {
        mode = next;
        localStorage.setItem(MODE_STORAGE_KEY, next);
      },
      onExit: () =>
        navigateTo(`${config.path}/vei/exit?to=${encodeURIComponent(currentLocation())}`),
      onPreviewAll: () => openFrame(`${config.path}/vei/changes?_vei=1`),
      onSave: () => void saveAll(),
      onReady: (handle) => {
        dock = handle;
      },
    }),
    scope,
  );

  /** The dock's "Preview all" badge - every distinct entry/singleton with a
   * pending draft ANYWHERE on the site, not just this page (unlike
   * `pendingTargets()` below, which `saveAll()` deliberately scopes to what
   * this page marks). Reads IndexedDB directly rather than diffing each
   * draft against its server value (what `pages/vei/ChangesPreview.tsx`
   * itself does) - that's a network round trip per entry, too heavy to redo
   * on every keystroke just for a badge count. */
  async function refreshPreviewCount(): Promise<void> {
    const records = await getAllEntryDraftRecords();
    dock.setPreviewCount(records.length);
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
      applyPreview({ name, value, typeSlug: target.type, entryId }, basePath);
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

  /** Previews what a click would do right now, via the highlight's own
   * color - Shift (`--dry-warning`, `intercept`'s "run the real action"
   * escape hatch) and Ctrl/Cmd (`--dry-info`, "open the full editor in a new
   * tab") each read differently from a plain click's default `--dry-primary`.
   * Reads straight off the triggering event rather than tracked booleans:
   * every `MouseEvent`/`KeyboardEvent` already carries the CURRENT modifier
   * state, so there's no separate keydown/keyup bookkeeping to keep in sync. */
  function applyHighlightColor(state: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    if (state.shiftKey) highlight.style.setProperty("--dry-highlight-color", "var(--dry-warning)");
    else if (state.ctrlKey || state.metaKey) highlight.style.setProperty("--dry-highlight-color", "var(--dry-info)");
    else highlight.style.removeProperty("--dry-highlight-color");
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (isModalSheetOpen()) return;
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
      applyHighlightColor(event);
    },
    true,
  );

  // The pointer doesn't have to move for the modifier state to go stale -
  // pressing/releasing Shift or Ctrl/Cmd while already hovering a field
  // changes what a click would do without any mousemove to recompute it from.
  window.addEventListener("keydown", (event) => {
    if (hoveredElement) applyHighlightColor(event);
  });
  window.addEventListener("keyup", (event) => {
    if (hoveredElement) applyHighlightColor(event);
  });

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
      dock.setStatus("No changes to save");
      return;
    }
    dock.setSaving(true);
    let failed = 0;
    for (const [index, target] of targets.entries()) {
      dock.setStatus(`Saving ${target.type} (${index + 1}/${targets.length})`);
      if (!(await saveTarget(target))) failed += 1;
    }
    if (failed > 0) {
      dock.setStatus(`${failed}/${targets.length} entries failed to save`);
      dock.setSaving(false);
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
  const panelResizeHandle = element("div", { className: "panel-resize-handle" });
  const panel = element("div", { className: "panel" }, [frame, panelLoading, panelResizeHandle]);
  sheet.append(panel);
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) closeDialog();
  });

  // Panel mode's width bounds - matches `useResizablePanel.ts`'s own
  // min/max-clamp shape (`src/lib/useResizablePanel.ts`), the Preact
  // equivalent of this drag used elsewhere (`PageComponents.tsx`'s sidebar).
  // DEFAULT matches `.sheet.docked .panel`'s own CSS default width.
  const PANEL_MIN_WIDTH = 320;
  const PANEL_MAX_WIDTH = 900;
  const PANEL_DEFAULT_WIDTH = 480;

  function clampPanelWidth(width: number): number {
    return Math.min(Math.max(width, PANEL_MIN_WIDTH), Math.min(PANEL_MAX_WIDTH, window.innerWidth * 0.9));
  }

  /** True once the docked panel is showing as a genuine right-hand SIDE
   * panel (desktop-width) rather than the mobile bottom drawer, which stays
   * a modal overlay - `SidebarToggle.tsx`'s own `matchMedia` query, same
   * `48rem` breakpoint `overlay-styles.ts`'s own `@media` block uses. */
  function isDesktopPanel(): boolean {
    return sheet.classList.contains("docked") && window.matchMedia("(width >= 48rem)").matches;
  }

  /**
   * True only while the sheet is up as a MODAL - dialog mode, or the mobile
   * bottom drawer. The desktop side panel deliberately isn't one: it leaves
   * the page visible, clickable (`.sheet.docked` is `pointer-events: none`,
   * `overlay-styles.ts`) and unscrolled-locked, so the hover highlight and
   * the click interception below have to keep running while it's open -
   * clicking another field then just re-points the panel at that field
   * (`openFrame`), instead of the page's own link/button behaviour firing
   * behind an editor that stays put.
   */
  function isModalSheetOpen(): boolean {
    return sheet.isConnected && !isDesktopPanel();
  }

  /**
   * Shrinks the live page itself (a plain `margin-right` on `<html>`, not a
   * wrapper - this script has no business restructuring the page's own DOM)
   * while the desktop panel is open, so the panel sits BESIDE the page
   * instead of covering it - the whole point of panel over dialog mode.
   * Fixed-position elements on the page are unaffected by a margin on
   * `<html>` either way, which is an accepted v1 gap.
   */
  function setPagePush(px: number | null, animate: boolean): void {
    document.documentElement.style.transition = animate ? "margin-right 160ms ease" : "";
    document.documentElement.style.marginRight = px === null ? "" : `${px}px`;
  }

  /** Re-derives the docked panel's push/width from the CURRENT viewport -
   * called on open and on every `resize` while a panel is showing, since
   * crossing the 48rem breakpoint mid-session (desktop panel <-> mobile
   * drawer) must not leave a stale inline `panel.style.width` fighting the
   * drawer's own 100%-width CSS, nor a stale page-push after the panel
   * stops being a side panel. */
  function syncDockedLayout(animate: boolean): void {
    if (isDesktopPanel()) {
      setPagePush(parseFloat(panel.style.width) || PANEL_DEFAULT_WIDTH, animate);
    } else {
      if (sheet.classList.contains("docked")) panel.style.width = "";
      setPagePush(null, false);
    }
  }

  window.addEventListener("resize", () => {
    if (sheet.isConnected) syncDockedLayout(false);
  });

  /**
   * Drag-to-resize for the desktop panel's left edge, via `setPointerCapture`
   * on the handle itself - unlike `table-column-resize.ts`'s window-level
   * `pointermove`/`pointerup` (this codebase's other vanilla drag-resize),
   * capture keeps EVERY subsequent pointer event targeted at the handle even
   * once the cursor outruns it during a fast drag, which a plain window
   * listener can lose the `pointerup` for entirely (leaving the drag stuck
   * "on" until the next unrelated click). `user-select: none` on `<html>`
   * for the drag's duration guards the same fast-drag case from instead
   * kicking off a text selection on the page underneath.
   */
  panelResizeHandle.addEventListener("pointerdown", (event) => {
    if (!isDesktopPanel()) return;
    event.preventDefault();
    panelResizeHandle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const previousUserSelect = document.documentElement.style.userSelect;
    document.documentElement.style.userSelect = "none";
    const onPointerMove = (moveEvent: PointerEvent) => {
      // The handle sits on the LEFT edge of a right-docked panel, so
      // dragging left (negative delta) is what WIDENS it.
      const next = clampPanelWidth(startWidth - (moveEvent.clientX - startX));
      panel.style.width = `${next}px`;
      setPagePush(next, false);
    };
    const onPointerUp = () => {
      panelResizeHandle.removeEventListener("pointermove", onPointerMove);
      document.documentElement.style.userSelect = previousUserSelect;
    };
    panelResizeHandle.addEventListener("pointermove", onPointerMove);
    panelResizeHandle.addEventListener("pointerup", onPointerUp, { once: true });
    panelResizeHandle.addEventListener("pointercancel", onPointerUp, { once: true });
  });

  let dialogLoadTimer: ReturnType<typeof setTimeout> | undefined;

  /** Opens the dialog on an arbitrary admin URL - the one field-edit dialog
   * this overlay otherwise only ever points at one entry's editor
   * (`openDialog` below), but "Preview all" has no single entry to aim at. */
  function openFrame(url: string): void {
    // Re-pointing an OPEN panel at another field is the normal case in panel
    // mode (see `isModalSheetOpen`), so the same URL twice must be a no-op
    // rather than a reload that throws away whatever is being typed in there
    // right now (draft writes are debounced 300ms - `saveEntryDraft`).
    const alreadyOpen = sheet.isConnected;
    if (alreadyOpen && frame.src === new URL(url, window.location.href).href) return;
    // Hidden unconditionally, and BEFORE the push below - `setPagePush`
    // animates a `margin-right` onto `<html>` in panel mode, which reflows
    // the whole page and moves the just-clicked field out from under the
    // highlight box mid-slide (it was positioned for the PRE-push layout).
    // Rather than re-measure mid-transition, just drop it here; the next
    // real `mousemove` re-marks and repositions it against the settled
    // layout, same as the scroll case above already does.
    hideHighlight();
    dock.setSheetOpen(true);
    sheet.classList.toggle("docked", mode === "panel");
    syncDockedLayout(!alreadyOpen);
    // The desktop panel is a non-modal side panel by design (see
    // syncDockedLayout/setPagePush) - only dialog mode and the mobile
    // bottom drawer stay modal and need the page's own scroll locked.
    if (!isDesktopPanel()) lockBodyScroll();
    panel.classList.add("loading");
    frame.src = url;
    // Re-appending a node it already holds would remove-and-reinsert `sheet`,
    // replaying `vei-panel-dock-in` on every field click.
    if (!alreadyOpen) scope.append(sheet);
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

  function closeDialog(): void {
    clearTimeout(dialogLoadTimer);
    unlockBodyScroll();
    setPagePush(null, true);
    dock.setSheetOpen(false);
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
      applyPreview(message.detail, basePath);
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
    if (isModalSheetOpen()) return;
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
