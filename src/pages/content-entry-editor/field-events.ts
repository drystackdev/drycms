/**
 * Lets code outside this bundle entirely - an AI assist feature, a browser
 * extension, any other plugin - observe and drive the entry/singleton edit
 * form (`ContentEntryEditor.tsx`) one top-level field at a time. Plain
 * `window` `CustomEvent`s on purpose, not an internal pub/sub export: the
 * whole point is reaching code that never imported anything from drycms.
 */

export const FIELD_INPUT_EVENT = "dry:field-input";
export const FIELD_SET_EVENT = "dry:field-set";

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

/** Attribute `renderFieldNodes` (`ContentEntryEditor.tsx`) sets on each
 * top-level field's own wrapper - both this field's own identity for the
 * `dry:field-input`/`dry:field-set` events above, and the anchor
 * `scrollToField` below searches for. */
export const FIELD_ANCHOR_ATTR = "data-field-name";

const HIGHLIGHT_CLASS = "entry-field-highlight";
const HIGHLIGHT_MS = 1500;

/**
 * `?_field=` deep link - scrolls the matching top-level field to the middle
 * of the viewport and flashes an outline for `HIGHLIGHT_MS` to draw the
 * user's eye to it (the CSS transition driving the actual fade lives on
 * `.entry-field-highlight` in components.css; this only toggles the class).
 * A no-op if no field with that name is on the page (typo'd name, or called
 * before the fields have rendered).
 */
export function scrollToField(name: string): void {
  const el = document.querySelector(`[${FIELD_ANCHOR_ATTR}="${CSS.escape(name)}"]`);
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add(HIGHLIGHT_CLASS);
  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
}
