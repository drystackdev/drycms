import { LockIcon } from "../../../components/icons/index.js";

/** Recreated verbatim if `styles/theme.css` is ever found missing - see
 * `GlobalsCssFile.tsx`'s doc comment. Semantic tokens point at the mutable
 * `--site-*` values in `base.css`, so Tailwind utilities such as
 * `bg-background` follow the active light/dark scheme too. */
export const DEFAULT_CONTENT = `@theme {
  --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-display: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  --color-background: var(--site-background);
  --color-foreground: var(--site-foreground);
  --color-surface: var(--site-surface);
  --color-muted: var(--site-muted);
  --color-border: var(--site-border);

  --color-primary-50: oklch(0.97 0.014 254.6);
  --color-primary-100: oklch(0.932 0.032 255.6);
  --color-primary-200: oklch(0.882 0.059 254.1);
  --color-primary-300: oklch(0.809 0.105 251.8);
  --color-primary-400: oklch(0.707 0.165 254.6);
  --color-primary-500: oklch(0.623 0.214 259.8);
  --color-primary-600: oklch(0.546 0.245 262.9);
  --color-primary-700: oklch(0.488 0.243 264.4);
  --color-primary-800: oklch(0.424 0.199 265.6);
  --color-primary-900: oklch(0.379 0.146 265.5);
  --color-primary-950: oklch(0.282 0.091 267.9);

  --radius-xs: 0.25rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;

  --shadow-card: 0 1px 2px rgb(15 23 42 / 6%), 0 8px 24px rgb(15 23 42 / 8%);
}
`;

/** One of the 3 small "what is this built-in file" cards shown in the Page
 * Editor's System tab - see `GlobalsCssFile.tsx`'s doc comment. */
export default function ThemeCssFile() {
  return (
    <div class="page-editor-core-style-file">
      <LockIcon class="page-editor-core-style-file-icon" aria-hidden="true" />
      <div>
        <h4>theme.css</h4>
        <p>
          Tailwind's <code>@theme</code> block - design tokens (colors, fonts, spacing) the site's
          utility classes are generated from.
        </p>
      </div>
    </div>
  );
}
