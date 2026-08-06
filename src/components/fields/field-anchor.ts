/**
 * The `data-field-name` anchor convention shared by `ContentEntryEditor.tsx`
 * (one per top-level entry field) and `ComponentField.tsx` (one per
 * top-level field of whichever repeatable item is currently open in its
 * dialog) - both scroll-to-and-flash a field found this way for the Visual
 * Editing Interface's `?_field=`/`?_path=` deep link (`overlay.ts`).
 *
 * Lives under `components/fields/` rather than `pages/content-entry-editor/`
 * (where the deep-link handling itself lives) because `ComponentField.tsx`
 * is a generic, reusable component -
 * it can't reach into `pages/` for this. `field-events.ts` re-exports
 * `FIELD_ANCHOR_ATTR` and wraps `highlightAnchor` for its own
 * `scrollToField`, so this stays the one place either side reads the
 * attribute name or the flash timing from.
 */
export const FIELD_ANCHOR_ATTR = "data-field-name";

const HIGHLIGHT_CLASS = "entry-field-highlight";
const HIGHLIGHT_MS = 1500;
const BOX_ID = "dry-field-highlight-box";
const BOX_INSET = 4;

/** Cancels the still-running rAF loop from a previous `highlightAnchor` call
 * on the same document, if any - a field visited twice in a row (two
 * dispatches of the same `_field` value) would otherwise leave two loops
 * fighting over the one box's position for the tail of the first call's
 * 1.5s. */
const cancelPreviousByDoc = new WeakMap<Document, () => void>();

/**
 * Finds the element anchored to `name` under `root` and, if there is one,
 * scrolls it to the middle of the viewport and flashes a ring around it for
 * `HIGHLIGHT_MS` (the fade itself is `.entry-field-highlight`'s own
 * animation in `components.css`; this only positions the box and removes it
 * once that animation ends). A no-op if nothing with that anchor is under
 * `root` - a typo'd name, or called before the target has rendered.
 *
 * The ring is a `position: fixed` box measured from the field's own
 * `getBoundingClientRect()`, not an outline on the field itself - an
 * outline is clipped by any scrolling/`overflow: hidden` ancestor
 * (`ComponentField.tsx`'s own repeatable-item dialog body) the moment the
 * field sits flush with its edge. It's appended to the nearest `<dialog>`
 * ancestor when there is one, rather than always to `<body>`: a `<dialog>`
 * shown via `showModal()` paints in the browser's top layer, which sits
 * above the rest of the document regardless of z-index, so a box appended
 * to `<body>` while editing a field inside one would paint UNDER the dialog
 * instead of over the field.
 */
export function highlightAnchor(root: ParentNode, name: string): void {
  const found = root.querySelector(
    `[${FIELD_ANCHOR_ATTR}="${CSS.escape(name)}"]`,
  );
  if (!(found instanceof HTMLElement)) return;
  const el = found;
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  const doc = el.ownerDocument;
  cancelPreviousByDoc.get(doc)?.();

  const host = el.closest("dialog") ?? doc.body;
  const box = doc.createElement("div");
  box.id = BOX_ID;
  box.className = HIGHLIGHT_CLASS;
  host.append(box);
  function position(): void {
    const rect = el.getBoundingClientRect();
    box.style.left = `${rect.left - BOX_INSET * 2}px`;
    box.style.top = `${rect.top - BOX_INSET * 2}px`;
    box.style.width = `${rect.width + BOX_INSET * 4}px`;
    box.style.height = `${rect.height + BOX_INSET * 4}px`;
  }
  position();

  // `scrollIntoView`'s own smooth-scroll (and, inside a dialog, that
  // dialog's own opening animation) moves `el` under the box over the next
  // several frames - this keeps the box pinned to the live rect for the
  // whole flash rather than the one measured before either has settled.
  let frame = requestAnimationFrame(function tick() {
    position();
    frame = requestAnimationFrame(tick);
  });
  const timer = setTimeout(cancel, HIGHLIGHT_MS);

  function cancel(): void {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    box.remove();
    cancelPreviousByDoc.delete(doc);
  }
  cancelPreviousByDoc.set(doc, cancel);
}
