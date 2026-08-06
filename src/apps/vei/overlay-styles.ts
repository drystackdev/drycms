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
  border-radius: 12px;
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
`;
