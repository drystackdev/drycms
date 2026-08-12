import { LockIcon } from "../../../components/icons/index.js";

/** Recreated verbatim if `styles/theme.css` is ever found missing - see
 * `GlobalsCssFile.tsx`'s doc comment. Semantic tokens point at the mutable
 * `--site-*` values in `base.css`, so Tailwind utilities such as
 * `bg-background` follow the active light/dark scheme too. */
export const DEFAULT_CONTENT = `@theme {
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
