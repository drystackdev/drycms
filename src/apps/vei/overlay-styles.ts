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
 */
export const OVERLAY_STYLES = `
/* Values copied from styles/tokens.css's Minimals palette (--dry-primary,
 * --dry-popover, --dry-foreground, --dry-muted-foreground, --dry-border,
 * --dry-backdrop, --dry-shadow-lg) - not referenced live, since a value
 * defined under ".dry" in the admin bundle's own stylesheet never reaches
 * this document at all (the public site loads Tailwind only, see
 * apps/globals.css). Keeping the SAME numbers here is what makes the
 * overlay read as part of the admin, not a foreign widget. */
:host {
  --vei-primary: #00a76f;
  --vei-surface: #ffffff;
  --vei-text: #1c252e;
  --vei-muted: #637381;
  --vei-border: rgb(145 158 171 / 20%);
  --vei-backdrop: rgb(145 158 171 / 80%);
  --vei-shadow-channel: 145 158 171;
  --vei-shadow:
    0 0 2px 0 rgb(var(--vei-shadow-channel) / 24%),
    -20px 20px 40px -4px rgb(var(--vei-shadow-channel) / 24%);
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
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: vei-spin 700ms linear infinite;
}

.vei-spinner.lg {
  width: 28px;
  height: 28px;
  border-width: 3px;
  border-color: var(--vei-border);
  border-top-color: var(--vei-primary);
}

button.ghost .vei-spinner {
  border-color: var(--vei-border);
  border-top-color: var(--vei-text);
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
  background: var(--vei-primary);
  color: #ffffff;
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
  color: var(--vei-text);
}

button.ghost:hover {
  background: rgba(145, 158, 171, 0.12);
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
  background: var(--vei-surface);
  border: 1px solid var(--vei-border);
  box-shadow: var(--vei-shadow);
  color: var(--vei-text);
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
  color: var(--vei-muted);
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
 * copied rather than referenced for the same reason the color values above
 * are copied: nothing in the admin's stylesheet reaches this document. */
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
  background: var(--vei-backdrop);
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
  background: var(--vei-surface);
  box-shadow: var(--vei-shadow);
  animation: vei-panel-in 120ms ease;
}

.sheet iframe {
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 12px;
  background: var(--vei-surface);
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
  background: var(--vei-surface);
}

.sheet .panel.loading .panel-loading {
  display: flex;
}

@media (prefers-color-scheme: dark) {
  :host {
    --vei-surface: #1c252e;
    --vei-text: #ffffff;
    --vei-muted: #919eab;
    --vei-backdrop: rgb(0 0 0 / 35%);
    --vei-shadow-channel: 0 0 0;
  }
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
  outline-offset: 2px;
  cursor: pointer;
}

html.dry-vei-editing [data-dry]:hover,
html.dry-vei-editing [data-dry-src]:hover,
html.dry-vei-editing [data-dry-html]:hover {
  outline: 2px solid #00a76f;
}
`;
