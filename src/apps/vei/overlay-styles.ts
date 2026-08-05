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
:host {
  --vei-primary: #00a76f;
  --vei-surface: #ffffff;
  --vei-text: #1c252e;
  --vei-muted: #637381;
  --vei-border: rgba(145, 158, 171, 0.24);
  --vei-shadow: 0 8px 24px rgba(145, 158, 171, 0.24);
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

button {
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

.sheet {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  display: flex;
  background: rgba(28, 37, 46, 0.48);
}

.sheet .panel {
  position: relative;
  margin: auto;
  display: flex;
}

.sheet .close {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  background: var(--vei-surface);
  color: var(--vei-text);
  border: 1px solid var(--vei-border);
  box-shadow: var(--vei-shadow);
  font-size: 18px;
  line-height: 1;
}

.sheet iframe {
  border: 0;
  width: min(920px, 100vw - 32px);
  height: min(720px, 100vh - 32px);
  border-radius: 12px;
  background: var(--vei-surface);
  box-shadow: var(--vei-shadow);
}

@media (prefers-color-scheme: dark) {
  :host {
    --vei-surface: #1c252e;
    --vei-text: #ffffff;
    --vei-muted: #919eab;
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
