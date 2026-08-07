import tokensCss from "../../styles/tokens.css?raw";

/**
 * The overlay's own chrome, as a string for its shadow root - the one place
 * in this feature where a shadow root IS the right tool (see `plans/vei.md`):
 * this is markup written here, with no `document`-level listeners to be
 * retargeted, and it has to survive whatever the host site's CSS does. The
 * field editor itself goes in an iframe instead, for the opposite reason.
 *
 * Not a `.css` file: the site's stylesheet is Tailwind's build output, and
 * a second `.css` entry would need its own Vite input + manifest lookup for
 * ~80 lines that only ever load inside this shadow root. Same call
 * `content-shadow-styles.ts` already made for RichText.
 *
 * The public site never loads `styles/tokens.css` (Tailwind only, see
 * `apps/globals.css`), so the admin's real `--dry-*` custom properties never
 * reach this document on their own - `tokensCss` (`?raw`, same pattern
 * `dry.carousel.tsx`/`Editer.tsx` already use for third-party CSS) inlines
 * the actual file verbatim instead of a hand-copied snapshot of its values,
 * so this stays correct if the palette ever changes and can't drift the way
 * a copy silently did once before (`status/vei.md`'s "màu + animation khớp
 * admin" polish note). Its rules are scoped to `.dry` - `overlay.ts` gives
 * exactly one element inside this shadow tree that class (`scope`), so
 * `light-dark()`/`--dry-*` resolve on it and cascade to every rule below.
 */
export const OVERLAY_STYLES = `
${tokensCss}

:host {
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

/* "all: initial" above only resets :host itself, not its descendants -
 * every element below still defaults to the UA stylesheet's content-box
 * like anywhere else on the web. .panel mixes width/height with padding,
 * so without this it would render wider/taller than specified. */
*,
*::before,
*::after {
  box-sizing: border-box;
}

@keyframes vei-spin {
  to {
    transform: rotate(360deg);
  }
}

.vei-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex: none;
  border: 2px solid color-mix(in srgb, var(--dry-primary-foreground) 40%, transparent);
  border-top-color: var(--dry-primary-foreground);
  border-radius: 50%;
  animation: vei-spin 700ms linear infinite;
}

.vei-spinner.lg {
  width: 28px;
  height: 28px;
  border-width: 3px;
  border-color: var(--dry-border);
  border-top-color: var(--dry-primary);
}

button.ghost .vei-spinner {
  border-color: var(--dry-border);
  border-top-color: var(--dry-foreground);
}

button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  cursor: pointer;
  border: 0;
  border-radius: 8px;
  padding: 8px 14px;
  background: var(--dry-primary);
  color: var(--dry-primary-foreground);
  font-weight: 600;
  font-size: 14px;
  line-height: 1.4;
}

button:disabled {
  cursor: default;
  opacity: 0.7;
}

button.ghost {
  background: transparent;
  color: var(--dry-foreground);
}

button.ghost:hover {
  background: var(--dry-accent);
}

button.icon {
  width: 40px;
  height: 40px;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
  flex: none;
}

button.round {
  border-radius: 32px;
}

button.icon.sm {
  width: 28px;
  height: 28px;
}

/* The dialog/panel toggle (Dock.tsx's ModeToggle) - same
 * inline-flex-pill-with-a-highlighted-pressed-button shape as
 * FileManager.tsx's ".file-view-toggle" (components.css), re-declared here
 * rather than shared since this shadow root never loads components.css. */
.mode-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dry-radius-md);
  background: var(--dry-secondary);
}

.mode-toggle button {
  background: transparent;
  color: var(--dry-muted-foreground);
  &.icon {
    border-radius: var(--dry-radius-sm);
  }
}

.mode-toggle button:hover {
  background: var(--dry-accent);
}

.mode-toggle button[aria-pressed="true"] {
  background: var(--dry-popover);
  color: var(--dry-foreground);
  box-shadow: var(--dry-shadow-xs);
}

/* Preview-count badge on the "Preview all" button - .badge/.sm/.secondary
 * mirror components.css's own rules for the identical admin classes
 * (overlay.ts sets exactly these on previewCount), scaled down to what this
 * dock actually uses rather than pulling in every badge variant. */
.badge {
  display: inline-flex;
  align-items: center;
  height: 1.5rem;
  padding-inline: 0.5rem;
  font-size: var(--dry-text-xs);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  border-radius: var(--dry-radius-sm);
}

.badge.sm {
  height: 1.25rem;
  padding-inline: 0.375rem;
}

.badge.secondary {
  background-color: var(--dry-secondary);
  color: var(--dry-foreground);
}

.dock {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 32px;
  background: var(--dry-popover);
  border: 1px solid var(--dry-border);
  box-shadow: var(--dry-shadow-lg);
  color: var(--dry-foreground);
  font-size: 14px;
  /* Width goes from unset (fit-content) to an explicit px value the first
   * time overlay.ts's animateDockWidth() runs, and stays explicit from then
   * on - transitioning "auto" itself isn't animatable, which is why that
   * function measures a real pixel width on both sides of every content
   * change instead of relying on this alone. overflow/flex-shrink below
   * keep mid-transition frames (a narrower box than the content's natural
   * size, for one frame) from visibly compressing the label/buttons. */
  transition: width 220ms ease;
  overflow: hidden;
}

.dock > * {
  flex-shrink: 0;
}

.dock .label {
  padding-inline: 6px;
  color: var(--dry-muted-foreground);
  font-size: 13px;
  white-space: nowrap;
}

/* Loads and runs, but never shows: the frame that replays each pending
   entry through the real editor's own Save (see overlay.ts's saveAll). */
iframe.agent {
  display: none;
}

/* opacity+scale / opacity-only - the exact pair components.css's own
 * "dialog"/"dialog::backdrop" rules use (dry-dialog-in/dry-dialog-backdrop-in),
 * copied rather than referenced for the same reason tokensCss above ISN'T
 * copied: an animation's keyframe steps aren't custom-property values a
 * var() can reach into, so there's no way to share these short of ?raw-ing
 * the whole of components.css for two keyframes. */
@keyframes vei-panel-in {
  from {
    opacity: 0;
    scale: 0.95;
  }
}

@keyframes vei-backdrop-in {
  from {
    opacity: 0;
  }
}

.sheet {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  display: flex;
  background: var(--dry-backdrop);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  animation: vei-backdrop-in 120ms ease;
}

/* A real card (background/radius/shadow of its own) padded around the
 * iframe, replacing the old bare iframe + a close button floating over its
 * corner - Cancel/close now lives INSIDE the frame, next to the admin's own
 * Preview button (ContentEntryEditor.tsx), so this card needs no header
 * of its own. */
.sheet .panel {
  position: relative;
  margin: auto;
  display: flex;
  flex-direction: column;
  width: min(920px, 100vw - 32px);
  height: min(720px, 100vh - 32px);
  padding: 12px;
  border-radius: 16px;
  background: var(--dry-popover);
  box-shadow: var(--dry-shadow-lg);
  animation: vei-panel-in 120ms ease;
}

.sheet iframe {
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 12px;
  background: var(--dry-popover);
}

/* Panel mode (overlay.ts's mode variable, toggled by Dock.tsx's ModeToggle):
 * on desktop this is a genuine non-modal SIDE panel, not another dialog -
 * no dimming/blur, and .sheet itself lets every click straight through to
 * the live page underneath (only .panel stays interactive) so the page is
 * fully visible and usable while editing. overlay.ts's setPagePush()
 * shrinks the page's own layout (a margin on <html>) to match, so the panel
 * sits BESIDE the page instead of on top of it. The mobile bottom drawer
 * overrides this back to a normal modal below (<48rem query) - nothing
 * pushes on that narrow a viewport, and a dimmed half-sheet is the ordinary
 * mobile pattern anyway. */
.sheet.docked {
  justify-content: flex-end;
  background: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  pointer-events: none;
}

.sheet.docked .panel {
  pointer-events: auto;
  margin: 0;
  width: 480px;
  height: 100dvh;
  max-width: 90vw;
  border-radius: 0;
  animation: vei-panel-dock-in 160ms ease;
}

@keyframes vei-panel-dock-in {
  from {
    translate: 100% 0;
  }
}

/* Drag-to-resize the docked panel's width - overlay.ts's own pointerdown/
 * pointermove wiring, following the same vanilla drag-resize shape
 * RichTextField's table-column-resize.ts uses. Hidden entirely outside
 * panel mode (dialog mode has nothing to resize). */
.panel-resize-handle {
  display: none;
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
  border-radius: 3px;
}

.panel-resize-handle:hover {
  background: var(--dry-primary);
}

.sheet.docked .panel-resize-handle {
  display: block;
}

/* Covers the iframe (still loading its own JS bundle underneath, so
 * otherwise a blank white rectangle) until the bridge announces
 * vei:ready - see overlay.ts's openDialog. */
.sheet .panel-loading {
  position: absolute;
  inset: 12px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--dry-popover);
}

.sheet .panel.loading .panel-loading {
  display: flex;
}

/* Below the app-wide mobile breakpoint (48rem/768px - components.css's
 * Select/DatePicker/Sidebar all use this same literal; there's no
 * breakpoint token in tokens.css to var() into), the docked panel becomes a
 * fixed-height bottom drawer instead of a resizable right sidebar - same
 * treatment those components already give their own popups. No resize
 * handle here: the user only asked for resize on the desktop right panel. */
@media (width < 48rem) {
  /* Restores the normal modal treatment the desktop rules above strip out -
   * a dimmed, click-catching backdrop behind a bottom drawer is the
   * ordinary mobile pattern, and there's no page to push aside on a
   * viewport this narrow. */
  .sheet.docked {
    background: var(--dry-backdrop);
    backdrop-filter: blur(5px);
    -webkit-backdrop-filter: blur(5px);
    pointer-events: auto;
  }

  /* Taken out of .sheet's flex layout entirely (fixed, not relative) so
   * .sheet.docked's own flex-end/right-docking has no say here - same
   * "position: fixed, override the desktop layout" move
   * components.css's .select-popup/.datepicker-popup mobile query makes. */
  .sheet.docked .panel {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    top: auto;
    width: 100%;
    max-width: 100%;
    height: 50vh;
    border-radius: 16px 16px 0 0;
    animation: vei-panel-dock-in-mobile 160ms ease;
  }

  .sheet.docked .panel-resize-handle {
    display: none;
  }
}

@keyframes vei-panel-dock-in-mobile {
  from {
    translate: 0 100%;
  }
}

/* The hover highlight around whatever marked field is under the pointer -
 * a fixed box positioned by overlay.ts from getBoundingClientRect(), not
 * an outline painted on the field itself. An outline inherits the target's
 * own stacking context and clipping, so a field inside an overflow: hidden
 * carousel/panel, or sitting behind a higher z-index sibling, would have
 * it clipped or covered - this box is a sibling of the whole page
 * (appended straight to body, same as .dock) instead, so neither problem
 * applies. pointer-events: none so it never steals the click meant for
 * the field underneath. */
.field-highlight {
  position: fixed;
  z-index: 2147482999;
  display: none;
  pointer-events: none;
  /* --dry-highlight-color is set inline by overlay.ts, reflecting whichever
   * modifier key (if any) is currently held - Shift/Ctrl/Cmd change what a
   * click on the hovered field will do, so the highlight itself previews
   * which via color instead of only being discoverable through the title
   * hint (EDIT_HINT) or by actually clicking. */
  outline: 3px solid var(--dry-highlight-color, var(--dry-primary));
  outline-offset: -1px;
  background: color-mix(in srgb, var(--dry-highlight-color, var(--dry-primary)) 8%, transparent);
  transition: left 100ms ease, top 100ms ease, width 100ms ease, height 100ms ease,
    outline-color 100ms ease, background-color 100ms ease;
}
`;

/**
 * Injected into the DOCUMENT, not the shadow root - the elements it targets
 * are the site's own, which a shadow root can't reach. Gated behind a class
 * on `<html>` so the rules cost nothing until edit mode is actually on.
 */
export const MARKER_STYLES = `
html.dry-vei-editing [data-dry],
html.dry-vei-editing [data-dry-src],
html.dry-vei-editing [data-dry-html] {
  outline: 1px dashed rgba(0, 167, 111, 0.6);
  cursor: pointer;
}

/* The field currently focused inside the panel/dialog's own form
 * (overlay.ts's "vei:focus" handling, relayed from ContentEntryEditor.tsx
 * via bridge.ts) - same outline, just solid instead of dashed, so it reads
 * as "this one, specifically" against every other marked field's baseline
 * dashed outline. Same specificity as the rule above; wins on source order
 * since it's declared after it. */
html.dry-vei-editing .dry-vei-focused {
  outline-style: solid;
}
`;
