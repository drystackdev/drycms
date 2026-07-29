/**
 * The stylesheet injected into RichTextField's own shadow root (see
 * \`useRichTextEditor.ts\`) rather than loaded as part of the app-wide
 * \`index.css\` cascade layers. That isolates the editable content's own
 * styling from the host page/app's CSS in both directions - nothing here
 * can leak out, and (this file's whole reason to exist) none of
 * \`dry.base\`'s \`:where(h2)\`/\`:where(p)\`/\`:where(ul, ol)\`/... resets, and
 * none of \`dry.forms\`/\`dry.components\`'s own rules, can reach in - so
 * everything those global layers used to supply for free (heading sizes,
 * paragraph/list margins, box-sizing, ...) has to be repeated here instead.
 *
 * Hand-authored directly in this file - edit the CSS text below and it
 * takes effect immediately, no separate \`.css\` source file or build step
 * involved (an earlier version of this file was regenerated from
 * \`../../styles/richtext-content.css\` by a build script - that indirection
 * has been dropped).
 *
 * CSS custom properties (\`--dry-*\`) are the one thing that DOES still cross
 * a shadow boundary (custom properties inherit through it like any other
 * inherited property), so every value below still reads live off the app's
 * own design tokens/current theme - only the *rules themselves* needed to
 * move in here, not the palette they use.
 *
 * Deliberately flat (no \`&\` nesting) even though the rest of this app's
 * authored CSS uses it freely - that authoring-time nesting is flattened by
 * the Astro demo app's own CSS pipeline before it ever reaches a browser,
 * but this string is assigned as a \`<style>\` tag's raw text and parsed by
 * the browser directly at runtime with no build step in between, so it has
 * to already be in a form every target browser's CSS engine accepts
 * unprocessed.
 */
export const richtextContentShadowStyles = `
:host {
  display: block;
}

/* The plain pass-through div \`EditorView\` appends its own \`.dry-tx-content\`
 * into (see \`useRichTextEditor.ts\`) - needs to fill whatever height the
 * shadow host (\`.richtext-content-mount\`, styled from the light DOM side)
 * ends up with, same "height:100% degrades to auto against an indefinite
 * containing block" reasoning \`.dry-tx-content\`'s own \`height: 100%\`
 * below relies on in turn. */
.dry-tx-content-host {
  height: 100%;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.dry-tx-content {
  position: relative;
  min-height: 10rem;
  height: 100%;
  padding: 0.5rem 0.875rem;
  color: var(--dry-foreground);
  font-family: var(--dry-font-sans);
  font-size: var(--dry-text-sm);
  line-height: var(--dry-leading);
  outline: none;
  overflow-y: auto;
  /* ProseMirror's own documented requirement (normally satisfied by loading
   * its \`style/prosemirror.css\` reference stylesheet, which this field
   * never has - everything it needs from that file is authored here
   * instead) - without it, consecutive spaces collapse and long unbroken
   * runs of text don't wrap the way a contenteditable needs to. */
  white-space: pre-wrap;
}

.dry-tx-content.is-empty::before {
  content: attr(data-placeholder);
  position: absolute;
  color: var(--dry-muted-foreground);
  pointer-events: none;
}

.dry-tx-content::selection,
.dry-tx-content *::selection {
  background-color: color-mix(in srgb, var(--dry-primary) 25%, transparent);
}

p {
  margin: 0;
}

h2, h3, h4, h5, h6 {
  margin: 0;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

h2 {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1.33;
}

h3 {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.5;
}

h4 {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.5;
}

h5 {
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.5;
}

h6 {
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.56;
}

strong, b {
  font-weight: 600;
}

blockquote {
  margin: 0;
  padding-inline-start: 1rem;
  border-inline-start: 2px solid var(--dry-border);
  color: var(--dry-muted-foreground);
  font-style: italic;
}

ul, ol {
  margin: 0;
  padding-inline-start: 1.25rem;
}

li {
  margin-block: 0.25rem;
}

/* Overrides the UA default \`display: inline\` an \`<img>\` would otherwise get
 * - needed so it flows inline with surrounding text like \`<em>\`/\`<strong>\`
 * do, same as it always was. */
.dry-tx-image {
  display: inline;
  object-fit: contain;
  max-width: 100%;
  max-height: 20rem;
  border-radius: var(--dry-radius-sm);
}

/* A \`NodeSelection\` (ProseMirror's selection type for the whole image, not
 * text inside it) is realized as a real DOM Range around this element, so
 * the browser paints its native selection style over it too - transparent
 * here leaves \`.is-selected\` below (an outline + shadow, no fill) as the
 * only visible "selected" indicator. */
.dry-tx-image::selection {
  background-color: transparent;
}

/* Outer node-view root (\`image-view.ts\`'s \`dom\`) - the live-editor
 * equivalent of \`html.ts\`'s exported \`<figure>\`: carries align/float over
 * both \`.dry-tx-image-box\` and (once there's a caption)
 * \`.dry-tx-image-caption\` below it. The \`.is-selected\` outline/shadow
 * itself lives on \`.dry-tx-image-box\` instead (below) - this box's own
 * height grows to include the caption once one exists, and the selection
 * frame shouldn't. \`vertical-align: baseline\` (the default for every other
 * inline tag here - <em>/<strong>/plain text) keeps an uncaptioned image
 * sitting on the text baseline like a normal inline element; \`middle\` would
 * center surrounding text on the image's own vertical middle instead. */
.dry-tx-image-wrapper {
  display: inline-block;
  vertical-align: baseline;
}

/* Wraps just the \`<img>\` (+ resize handles) so their \`top\`/\`left\`
 * percentages (see image-view.ts) anchor to a box that hugs the image
 * exactly, regardless of whether \`.dry-tx-image-caption\` below adds
 * height to the wrapper above - \`line-height: 0\` keeps this box from adding
 * baseline strut space around the (inline) image. The \`.is-selected\`
 * outline/shadow lives here rather than on the wrapper for the same
 * reason: this box's edges are exactly the handles' own \`0%\`/\`100%\` anchor
 * points, so the frame can't drift from them the way it would riding the
 * wrapper's own (caption-inclusive, and independently strut-affected) box
 * instead. */
.dry-tx-image-box {
  position: relative;
  display: inline-block;
  line-height: 0;
}

.dry-tx-image-box.is-selected {
  outline: 2px solid var(--dry-primary);
  outline-offset: 1px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dry-primary) 18%, transparent);
}

.dry-tx-image-handle {
  position: absolute;
  width: 0.625rem;
  height: 0.625rem;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  border-radius: 50%;
  background: var(--dry-background);
  border: 2px solid var(--dry-primary);
  z-index: 1;
}

/* Admin-editing-only skin, matching drystack's own \`figcaptionClass\`: the
 * exported \`<figcaption>\` (\`html.ts\`'s \`imageChildHtml\`) carries none of
 * this, so a consumer page's own typography is what actually renders once
 * published - this is purely what the caption looks like while editing.
 * \`contentEditable="false"\` (set in image-view.ts) - it isn't itself
 * editable text, only the edit dialog's Caption field is. */
.dry-tx-image-caption {
  display: block;
  margin-block-start: 0.375rem;
  font-size: var(--dry-text-xs);
  font-style: italic;
  line-height: var(--dry-leading);
  color: var(--dry-muted-foreground);
  text-align: center;
}

/* \`table\`'s own \`toDOM\` (schema.ts) wraps every table in this - a
 * horizontal scroller so a table wider than the field doesn't blow out its
 * layout, matching \`prosemirror-tables\`' own reference stylesheet
 * (\`style/tables.css\`) but re-themed onto this field's own tokens instead
 * of its hardcoded colors. */
.tableWrapper {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  margin-block: 0.5rem;
}

/* A table's own \`<caption>\` (schema.ts's \`table.toDOM\`, filled in via
 * table-menu.tsx's caption popover) - same subtle, muted treatment as
 * \`.dry-tx-image-caption\` above, this field's other caption-shaped element.
 * \`contenteditable="false"\` (set in schema.ts) - only the caption popover's
 * own \`TextField\` is directly editable. */
table > caption {
  margin-block-end: 0.375rem;
  font-size: var(--dry-text-xs);
  font-style: italic;
  color: var(--dry-muted-foreground);
}

td, th {
  position: relative;
  box-sizing: border-box;
  vertical-align: top;
  min-width: 3em;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--dry-border);
}

th {
  background-color: var(--dry-muted);
  font-weight: 600;
  text-align: left;
}

/* \`tableEditing()\`'s own \`CellSelection\` decoration - a translucent overlay
 * per selected cell, same tint \`.dry-tx-image-box.is-selected\`'s
 * box-shadow above uses for "selected" elsewhere in this field. */
.selectedCell::after {
  position: absolute;
  inset: 0;
  z-index: 2;
  content: "";
  background-color: color-mix(in srgb, var(--dry-primary) 20%, transparent);
  pointer-events: none;
}

/* \`table-row-resize.ts\`'s own hand-rolled cursor swap for a row's
 * bottom-edge handle. */
.dry-tx-content.dry-tx-table-resize-cursor {
  cursor: row-resize;
}

/* \`table-column-resize.ts\`'s own equivalent, for a column's right-edge
 * handle - no colored handle bar (unlike \`prosemirror-tables\`' own
 * \`columnResizing()\`, which this field no longer uses - see schema.ts's
 * own doc comment), just the cursor swap. */
.dry-tx-content.dry-tx-table-col-resize-cursor {
  cursor: col-resize;
}
`;
