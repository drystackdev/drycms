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

export const richtextContentShadowStyles = /*css*/`
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
  font-weight: 400;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.dry-tx-content {
  position: relative;
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
  font-weight: 900;
}

blockquote {
  margin: 0;
  padding-inline-start: 1rem;
  border-inline-start: 2px solid var(--dry-border);
  color: var(--dry-muted-foreground);
  font-style: italic;
}

a {
  color: var(--dry-primary);
  text-decoration: underline;
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

/* Once there's a caption (\`image-view.ts\`'s \`render()\` toggles this class
 * alongside appending/removing \`.dry-tx-image-caption\`), switch to the same
 * \`display: table\` / \`table-caption\` trick \`html.ts\`'s \`imageChildHtml\`
 * already exports: an \`inline-block\` wrapper sizes itself to the caption's
 * unwrapped max-content width (its shrink-to-fit preferred width), so a
 * caption longer than the image stretches the wrapper wider than the image
 * instead of wrapping. \`display: table-caption\` is the one display value
 * whose box is forced to exactly the table's own width, so the caption
 * wraps at the image's edge instead. \`caption-side: bottom\` is required
 * alongside it - a table-caption box renders at its specified side
 * regardless of DOM order, and the default is \`top\`.
 *
 * \`vertical-align: top\` overrides the plain wrapper's own \`baseline\`
 * above - confirmed empirically (Playwright) this is NOT the same case as
 * the uncaptioned one: an \`inline-table\`'s baseline is defined as its
 * first row's baseline, and \`table-caption\` boxes are excluded from row
 * baseline calculation entirely (CSS Tables §"Table height algorithm"), so
 * \`baseline\` here would align surrounding text to the *image's* baseline
 * alone - as if the caption below it didn't exist. Surrounding text ends
 * up sitting beside the image with the caption's whole height showing as
 * dead space below that text instead of the two reading as one block.
 * \`top\` aligns surrounding text to the *whole* figure's (image + caption)
 * top edge instead, so text starts flush with the image regardless of how
 * tall the caption underneath it is. */
.dry-tx-image-wrapper.has-caption {
  display: inline-table;
  vertical-align: bottom;
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
  display: table-caption;
  caption-side: bottom;
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
 * \`caption-side: bottom\` matches the published styling (base.css's
 * \`:where(caption)\`) - without it the UA default (\`top\`) would render the
 * caption above \`thead\`/\`tbody\` while editing but below once published.
 * \`contenteditable="false"\` (set in schema.ts) - only the caption popover's
 * own \`TextField\` is directly editable. */
table > caption {
  caption-side: bottom;
  margin-block-start: 0.375rem;
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

/* Grid layout (\`grid.ts\`/\`schema.ts\`) - a fixed 12-column CSS grid
 * wrapper, each cell (\`grid_item\`) owning its own \`colSpan\`/\`rowSpan\`.
 * Unlike \`table\` above, none of the actual layout needs a rule here: the
 * real \`display:grid\`/\`grid-column\`/\`grid-row\` values travel as inline
 * \`style\` on the elements themselves (see \`gridContainerStyleString\`/
 * \`gridItemStyleString\` in schema.ts), so both the live editor and exported
 * HTML render identically with no shared stylesheet involved - what's here
 * is purely editing chrome (highlight/focus/resize-handle skin). */
.dry-tx-grid {
  margin-block: 0.5rem;
}

.dry-tx-grid-item {
  position: relative;
  min-width: 0;
}

/* \`grid-resize.ts\`'s own \`highlightLine\` toggle - every cell gets a dashed
 * outline while it's on, brightening on hover so which cell a click would
 * land in reads clearly before it's actually focused. \`border-color\`
 * (not \`border-style\`/\`border-width\`) is what \`.dry-tx-grid-focused\`
 * below overrides to hide this on the focused cell specifically - keeping
 * the same 1px border-width there avoids a layout shift when focus moves
 * on/off a cell, unlike removing the border outright. */
.dry-tx-grid-highlight > .dry-tx-grid-item {
  outline: 1px dashed var(--dry-border);
}

/* The currently-focused cell (selection sits inside it) - a stronger,
 * offset outline replaces the plain dashed border every other cell still
 * carries (hidden via transparent, see above), rather than showing both at
 * once. Selector kept as specific as \`.dry-tx-grid-highlight > .dry-tx-grid-item\`
 * itself (not just \`.dry-tx-grid-focused\` alone) - a single-class selector
 * loses the border-color cascade to that two-class rule regardless of
 * source order, since specificity (not position) decides between rules
 * that don't share it. */
.dry-tx-grid-highlight > .dry-tx-grid-item.dry-tx-grid-focused {
  outline: 1px solid var(--dry-primary);
}

/* \`grid-item-view.ts\`'s own 2 resize handles - always in the DOM, but only
 * shown once both \`.dry-tx-grid-highlight\` (the toggle is on) and
 * \`.dry-tx-grid-focused\` (this is the focused cell) apply - see that
 * file's own doc comment for why visibility lives here in CSS rather than
 * in the node view's own JS. */
.dry-tx-grid-handle {
  display: none;
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  background: var(--dry-background);
  border: 2px solid var(--dry-primary);
}

.dry-tx-grid-highlight > .dry-tx-grid-focused > .dry-tx-grid-handle {
  display: block;
}

.dry-tx-grid-handle-col {
  top: 50%;
  right: 0;
  width: 0.625rem;
  height: 1.25rem;
  border-radius: var(--dry-radius-sm);
  transform: translate(50%, -50%);
  cursor: col-resize;
}

.dry-tx-grid-handle-row {
  right: 0;
  bottom: 0;
  width: 1.25rem;
  height: 0.625rem;
  border-radius: var(--dry-radius-sm);
  transform: translate(50%, 50%);
  cursor: row-resize;
}

/* "Reorder mode" (\`reorder-mode.ts\`) - suppresses the caret/native text
 * selection while it's on, since typing/formatting is suspended for the
 * duration (\`useRichTextEditor.ts\`'s \`editable\`) and a lingering text
 * cursor would otherwise look like editing still works. Also hides every
 * other resize handle this field has (grid/table col/row) - those aren't
 * gated by \`view.editable\` themselves, so without this they'd still work
 * mid-reorder, which reads as a stray inconsistency during an otherwise
 * fully "everything else is suspended" mode. */
.dry-tx-content.dry-tx-reorder-active {
  caret-color: transparent;
  user-select: none;
}

.dry-tx-content.dry-tx-reorder-active .dry-tx-grid-handle,
.dry-tx-content.dry-tx-reorder-active .dry-tx-image-handle {
  display: none !important;
}

/* Every \`group:"block"\` node (schema.ts) while reorder mode is active - a
 * light tint, a real border/padding/margin (not just the tint) so adjacent
 * AND nested blocks read as clearly separate cards rather than blurring
 * together, and \`border-radius\` since these now read as chrome/controls for
 * the duration, not plain content. Strengthened slightly on hover so a block
 * reads as interactive before the pointer is even pressed down; \`grab\`/
 * \`grabbing\` cursor since a pointerdown anywhere on a block starts dragging
 * it - there's no separate drag handle (\`onBlockPointerDown\` in
 * reorder-mode.ts). */
.dry-tx-reorder-block {
  padding: 0.5rem;
  margin: 0.25rem 0;
  border: 1px solid var(--dry-border);
  border-radius: var(--dry-radius-sm);
  background-color: color-mix(in srgb, var(--dry-foreground) 6%, transparent);
  cursor: grab;
}

.dry-tx-reorder-block:hover {
  background-color: color-mix(in srgb, var(--dry-foreground) 12%, transparent);
}

.dry-tx-reorder-block:active {
  cursor: grabbing;
}

/* \`grid\`, plus any \`children:true\` dry component (\`isContainerNode\` in
 * reorder-mode.ts) - this schema's "container" block types - get an outline
 * in the same color as body text on top of the border/tint above, so a
 * container reads as visually distinct from a plain paragraph/heading at a
 * glance. \`table\` is deliberately NOT included - see reorder-mode.ts's own
 * top doc comment for why. */
.dry-tx-reorder-container {
  outline: 1px solid var(--dry-foreground);
  outline-offset: 2px;
}

/* The empty paragraph \`insertTable\`/\`insertGrid\`/\`trailing-paragraph.ts\`
 * leave (or maintain) after the last block so there's always somewhere to
 * click - not real content, so reorder mode hides it outright rather than
 * showing it as just another empty card (\`isTrailingEmptyParagraph\` in
 * reorder-mode.ts). */
.dry-tx-reorder-hidden {
  display: none !important;
}

/* Cmd/Ctrl+click multi-selection - a stronger, offset outline in the same
 * accent color selection/focus chrome uses elsewhere in this field (e.g.
 * \`.dry-tx-image-box.is-selected\`), layered on top of \`.dry-tx-reorder-container\`'s
 * own outline rather than replacing it (a selected container still reads as
 * a container). */
.dry-tx-reorder-selected {
  outline: 2px solid var(--dry-primary);
  outline-offset: 3px;
}

/* The node(s) currently being dragged, at their ORIGINAL position - hidden
 * outright; a real floating clone tracks the pointer instead
 * (\`.dry-tx-reorder-overlay\` below, \`buildDragOverlay\` in
 * reorder-mode.ts). */
.dry-tx-reorder-dragging {
  display: none;
}

/* The floating clone stack itself (\`buildDragOverlay\` in reorder-mode.ts) -
 * \`position\`/\`top\`/\`left\`/\`width\`/\`transform\` are all set inline by that
 * function; a solid card background plus a real shadow (not just the plain
 * tint every \`.dry-tx-reorder-block\` gets) so it reads as lifted off the
 * page entirely, matching \`.dnd-dragging\` in components.css. */
.dry-tx-reorder-overlay {
  pointer-events: none;
  z-index: 50;
}

.dry-tx-reorder-overlay .dry-tx-reorder-block {
  margin: 0;
  background-color: var(--dry-background);
  box-shadow: var(--dry-shadow-lg);
}

/* Drop feedback for an *occupied* \`grid_item\`/table-cell-placeholder
 * target as a whole (\`"replaceGridItem"\`/\`"replaceCellContent"\`, which
 * always accept a drop as an outright replace rather than needing before/
 * after disambiguation - see \`computeDropTarget\`'s own doc comment in
 * reorder-mode.ts). A plain \`before\`/\`after\` target gets no highlight of
 * its own anymore - just the ghost slot widget below, which used to sit
 * alongside a thin edge-highlight box-shadow here too, dropped for the
 * visible stutter it added (the sibling's own decoration tearing down and
 * rebuilding on every target change, on top of the ghost widget doing the
 * same). */
.dry-tx-reorder-drop-target {
  outline: 2px dashed var(--dry-primary);
  outline-offset: 2px;
}

/* The "ghost slot" widget (\`buildGhostWidget\` in reorder-mode.ts) inserted
 * right at a live \`before\`/\`after\` target - own \`height\` set inline by
 * that function, matching the dragged content's combined height, so this
 * reads as "the real thing lands in exactly this much space". Same
 * dashed-outline language \`.dry-tx-reorder-drop-target\` above uses for its
 * own "this exact spot" signal, just filled in with the accent tint since
 * this one has no real
 * content of its own to show through. */
.dry-tx-reorder-ghost {
  margin: 0.25rem 0;
  border: 2px dashed var(--dry-primary);
  border-radius: var(--dry-radius-sm);
  background-color: color-mix(in srgb, var(--dry-primary) 8%, transparent);
  pointer-events: none;
}

/* dry-component-view.ts's own wrapper/box/handle set, same shape as
   .dry-tx-image-wrapper/.dry-tx-image-box/.dry-tx-image-handle above (resize
   handles anchor to the box's own edges, not the wrapper's) - inline-type
   components only; block ones have no wrapper at all (nothing to float/
   resize against, see schema.ts's buildDryNodeSpecs) and get
   .dry-component-is-selected directly on the custom element itself instead -
   one rule, applied wherever that class actually lands. Own class names
   rather than reusing .is-selected: these wrap/select an arbitrary custom
   element (a dynamic dry-name tag with its own author-defined internals),
   so a shared name risks colliding with that component's own styles. */
/* bottom, not baseline like .dry-tx-image-wrapper above - confirmed
   empirically (Playwright) this is NOT the same case as image: for a true
   replaced element (a real img tag), vertical-align: baseline reliably
   means "this element's bottom edge sits on the line's text baseline",
   spec-mandated and consistent regardless of surrounding content order.
   This wrapper is a plain inline-block, not a replaced element - its
   baseline is only inferred (falls back to its own bottom margin edge
   since it has no in-flow line boxes inside), and that inference turned out
   to be order-sensitive in Chrome: identical markup/CSS rendered correctly
   with the component before surrounding text, but visibly mid-line when
   placed after text on the same line - same computed wrapper rect either
   way, so it was the text's own baseline shifting inside the (very tall)
   line box, not the wrapper. bottom sidesteps the inference entirely -
   "this box's bottom edge sits on the line box's own bottom edge" doesn't
   depend on any baseline computation, so it can't be order-sensitive the
   same way. */
.dry-component-wrapper {
  display: inline-block;
  vertical-align: bottom;
}

/* line-height: 0 - same reason as .dry-tx-image-box above: keeps this box's
   own inline strut from adding baseline spacing around its content, which
   is what was throwing off vertical-align: baseline on the wrapper (the
   box's height was being padded by an invisible line box on top of the
   actual custom element). */
.dry-component-box {
  position: relative;
  display: inline-block;
  line-height: 0;
  &>*:first-child{
    overflow: hidden;
  }
}

/* Same reasoning as \`.dry-tx-image::selection\` above: a NodeSelection (or an
 * ordinary text drag spanning across this inline node) is realized as a real
 * DOM Range around it, so the browser paints its native selection style over
 * the component's own rendered internals too - transparent here leaves
 * \`.dry-component-is-selected\` below (an outline + shadow, no fill) as the
 * only visible "selected" indicator. Only reaches a \`shadow: false\`
 * component's own (light-DOM) internals - a \`shadow: true\` one (the
 * default, see \`register-component.ts\`) needs the same override
 * re-declared inside its own shadow root instead, since \`::selection\`
 * doesn't inherit across a shadow boundary - see \`dry-component-runtime.ts\`. */
.dry-component-box::selection,
.dry-component-box *::selection {
  background-color: transparent;
}

.dry-component-is-selected {
  outline: 2px solid var(--dry-primary);
  outline-offset: 1px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dry-primary) 18%, transparent);
}

.dry-component-handle {
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
`;
