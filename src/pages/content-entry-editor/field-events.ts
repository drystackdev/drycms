/**
 * Lets code outside this bundle entirely - an AI assist feature, a browser
 * extension, any other plugin - observe and drive the entry/singleton edit
 * form (`ContentEntryEditor.tsx`) one top-level field at a time. Plain
 * `window` `CustomEvent`s on purpose, not an internal pub/sub export: the
 * whole point is reaching code that never imported anything from drycms.
 */
import { FIELD_ANCHOR_ATTR, highlightAnchor } from "../../components/fields/field-anchor.js";

export { FIELD_ANCHOR_ATTR };

export const FIELD_INPUT_EVENT = "dry:field-input";
export const FIELD_SET_EVENT = "dry:field-set";
export const FIELD_FOCUS_EVENT = "dry:field-focus";
/** Whole-entry counterparts of the two field events: ask the open editor to
 * run its own Save (`dry:entry-save`), and hear back how it went
 * (`dry:entry-saved`). The Visual Editing Interface (`plans/vei.md`) saves
 * several entries in a row this way, driving the real editor rather than
 * reimplementing its save path - validation, draft cleanup and error
 * reporting all stay in the one place that already does them. */
export const ENTRY_SAVE_EVENT = "dry:entry-save";
export const ENTRY_SAVED_EVENT = "dry:entry-saved";

export interface EntrySavedEventDetail {
  ok: boolean;
}

export interface FieldInputEventDetail {
  /** The entry's own top-level field name (`EntryFieldNode.fieldName`) -
   * what `?_field=` on the URL also matches, see `ContentEntryEditor.tsx`'s
   * scroll-to-field effect. */
  name: string;
  value: unknown;
  typeSlug: string;
  /** `null` for a not-yet-saved new entry. */
  entryId: string | null;
}

export interface FieldFocusEventDetail {
  /** The EXACT field that gained focus (the full `[data-field-name]`
   * anchor, e.g. `"hero.headline"` for a `flatten`-nested field), or `null`
   * once focus leaves every field (`focusout` finding no `[data-field-name]`
   * ancestor on whatever's next). Unlike `dry:field-input` (always the
   * top-level name only, since that's all a value write can address without
   * threading the rest of `EntryValue`'s shape through - see
   * `applyFieldSet`'s own doc comment), this is matched EXACTLY against a
   * marker's `ref.path` on the other end (Page Builder's preview highlight)
   * so only the one field actually focused highlights, not every marker
   * under the same top-level component. A field nested inside a
   * `component-repeat` item's own dialog is a known gap: that dialog names
   * its fields with no outer prefix at all (`FieldRenderer.tsx`'s
   * `renderItem`), so it can't be matched this way - same boundary
   * `?_path=`'s own deep link already stops at. */
  name: string | null;
  typeSlug: string;
  entryId: string | null;
}

export interface FieldSetEventDetail {
  /** A plain top-level field name, OR a dotted/indexed path reaching into a
   * `component-repeat` array item's own fields (e.g. `"data.0.name.label"`)
   * - see `field-path.ts`'s `setValueAtPath` for exactly how a path resolves
   * against the entry's `EntryValue`, and its own doc comment for the
   * degrade-safely behavior on an invalid one. */
  name: string;
  value: unknown;
}

const DEBOUNCE_MS = 300;
const pendingDispatches = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Emits `dry:field-input` on `window` - a live "here's what the user is
 * typing" signal, debounced per field name (not globally: two different
 * fields changing back-to-back shouldn't cancel each other's timer) so a
 * fast typist doesn't flood listeners with one event per keystroke.
 */
export function dispatchFieldInput(
  name: string,
  value: unknown,
  context: { typeSlug: string; entryId: string | null },
): void {
  const pending = pendingDispatches.get(name);
  if (pending !== undefined) clearTimeout(pending);
  pendingDispatches.set(
    name,
    setTimeout(() => {
      pendingDispatches.delete(name);
      window.dispatchEvent(
        new CustomEvent<FieldInputEventDetail>(FIELD_INPUT_EVENT, {
          detail: { name, value, typeSlug: context.typeSlug, entryId: context.entryId },
        }),
      );
    }, DEBOUNCE_MS),
  );
}

/** The listening half of `dispatchFieldInput` above. Outside code can of
 * course call `window.addEventListener(FIELD_INPUT_EVENT, ...)` itself -
 * that's the point of these being plain CustomEvents - but every in-repo
 * consumer would then repeat the same detail-shape cast, so it lives here
 * next to the dispatcher instead (mirroring `listenForFieldSet`). */
export function listenForFieldInput(onInput: (detail: FieldInputEventDetail) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<FieldInputEventDetail>).detail;
    if (!detail || typeof detail.name !== "string") return;
    onInput(detail);
  };
  window.addEventListener(FIELD_INPUT_EVENT, handler);
  return () => window.removeEventListener(FIELD_INPUT_EVENT, handler);
}

/**
 * Emits `dry:field-focus` on `window` whenever a top-level field gains or
 * loses focus - Page Builder's visual editing panel uses this to
 * scroll the corresponding marked element into view and swap its baseline
 * dashed outline for a solid one while the admin is actually working on it.
 * Undebounced (unlike `dispatchFieldInput`): a focus change is already one
 * discrete event, not a stream of keystrokes to coalesce.
 */
export function dispatchFieldFocus(
  name: string | null,
  context: { typeSlug: string; entryId: string | null },
): void {
  window.dispatchEvent(
    new CustomEvent<FieldFocusEventDetail>(FIELD_FOCUS_EVENT, {
      detail: { name, typeSlug: context.typeSlug, entryId: context.entryId },
    }),
  );
}

export function listenForFieldFocus(onFocus: (detail: FieldFocusEventDetail) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<FieldFocusEventDetail>).detail;
    if (!detail) return;
    onFocus(detail);
  };
  window.addEventListener(FIELD_FOCUS_EVENT, handler);
  return () => window.removeEventListener(FIELD_FOCUS_EVENT, handler);
}

/**
 * The other direction - an outside listener drives a field by dispatching
 * `dry:field-set` on `window` with `{ name, value }`. Always overwrites,
 * even mid-typing (same as a user typing over their own selection) - a
 * caller wanting to avoid clobbering an active edit is expected to check
 * `document.activeElement` itself before dispatching.
 */
export function listenForFieldSet(onSet: (name: string, value: unknown) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<FieldSetEventDetail>).detail;
    if (!detail || typeof detail.name !== "string") return;
    onSet(detail.name, detail.value);
  };
  window.addEventListener(FIELD_SET_EVENT, handler);
  return () => window.removeEventListener(FIELD_SET_EVENT, handler);
}

/**
 * A save request that nobody has carried out yet.
 *
 * `ENTRY_SAVE_EVENT` is a plain CustomEvent, so a request dispatched while
 * no editor is mounted - or while the mounted one is still fetching its
 * entry - simply vanishes. That is the normal case, not an edge one: the
 * Visual Editing Interface drives a save through `content-entry-editor/builder-bridge.ts` as
 * soon as the frame announces itself (`App.tsx`'s mount effect), which is
 * milliseconds before the route-split `ContentEntryEditor` has mounted, let
 * alone loaded anything to save. This latch is what makes the request
 * survive that gap: it stays set until an editor that can actually act on
 * it takes it (`takeEntrySaveRequest`).
 */
let entrySaveRequested = false;

/** The dispatching half - use this rather than dispatching
 * `ENTRY_SAVE_EVENT` by hand, so the latch above is always set with it. */
export function dispatchEntrySave(): void {
  entrySaveRequested = true;
  window.dispatchEvent(new CustomEvent(ENTRY_SAVE_EVENT));
}

/** Claims a pending save request, if there is one - returns `true` at most
 * once per `dispatchEntrySave()`, so an editor can gate on it from both its
 * live listener and its post-load re-check without saving twice. */
export function takeEntrySaveRequest(): boolean {
  const requested = entrySaveRequested;
  entrySaveRequested = false;
  return requested;
}

export function listenForEntrySave(onSave: () => void): () => void {
  const handler = () => onSave();
  window.addEventListener(ENTRY_SAVE_EVENT, handler);
  return () => window.removeEventListener(ENTRY_SAVE_EVENT, handler);
}

export function dispatchEntrySaved(ok: boolean): void {
  window.dispatchEvent(new CustomEvent<EntrySavedEventDetail>(ENTRY_SAVED_EVENT, { detail: { ok } }));
}

export function listenForEntrySaved(onSaved: (detail: EntrySavedEventDetail) => void): () => void {
  const handler = (event: Event) => onSaved((event as CustomEvent<EntrySavedEventDetail>).detail ?? { ok: false });
  window.addEventListener(ENTRY_SAVED_EVENT, handler);
  return () => window.removeEventListener(ENTRY_SAVED_EVENT, handler);
}

/**
 * `?_field=` deep link - scrolls the matching top-level field to the middle
 * of the viewport and flashes its outline (`highlightAnchor`,
 * `components/fields/field-anchor.ts`). A no-op if no field with that name
 * is on the page (typo'd name, or called before the fields have rendered).
 */
export function scrollToField(name: string): void {
  highlightAnchor(document, name);
}
