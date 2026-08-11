import { LockIcon } from "../../../components/icons/index.js";

/** Recreated verbatim if `styles/base.css` is ever found missing - see
 * `GlobalsCssFile.tsx`'s doc comment. This is deliberately a small set of
 * site-wide, accessible defaults; component styling stays in utilities. */
export const DEFAULT_CONTENT = `@layer base {
  :root {
    color-scheme: light dark;
    --site-background: oklch(0.985 0.002 247.8);
    --site-foreground: oklch(0.21 0.034 264.7);
    --site-surface: oklch(1 0 0);
    --site-muted: oklch(0.968 0.007 247.9);
    --site-border: oklch(0.929 0.013 255.5);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --site-background: oklch(0.145 0.02 264.7);
      --site-foreground: oklch(0.968 0.007 247.9);
      --site-surface: oklch(0.208 0.042 265.8);
      --site-muted: oklch(0.278 0.033 256.8);
      --site-border: oklch(1 0 0 / 12%);
    }
  }

  html {
    min-height: 100%;
    scroll-behavior: smooth;
    text-rendering: optimizeLegibility;
  }

  body {
    min-height: 100vh;
    background: var(--site-background);
    color: var(--site-foreground);
    font-family: var(--font-sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  :where(button, input, select, textarea) {
    font: inherit;
  }

  :where(img, picture, video, canvas, svg) {
    display: block;
    max-width: 100%;
  }

  :where(a, button, input, select, textarea):focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  ::selection {
    background: var(--color-primary-200);
    color: var(--color-primary-950);
  }

  @media (prefers-reduced-motion: reduce) {
    html {
      scroll-behavior: auto;
    }
  }
}
`;

/** One of the 3 small "what is this built-in file" cards shown in the Page
 * Editor's System tab - see `GlobalsCssFile.tsx`'s doc comment. */
export default function BaseCssFile() {
  return (
    <div class="page-editor-core-style-file">
      <LockIcon class="page-editor-core-style-file-icon" aria-hidden="true" />
      <div>
        <h4>base.css</h4>
        <p>
          Tailwind's <code>@layer base</code> - element resets and default tag styles applied
          site-wide.
        </p>
      </div>
    </div>
  );
}
