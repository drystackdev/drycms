import { LockIcon } from "../../../components/icons/index.js";

/** Recreated verbatim if `styles/theme.css` is ever found missing - see
 * `GlobalsCssFile.tsx`'s doc comment. Matches the blank starter every new
 * site's theme begins as. */
export const DEFAULT_CONTENT = `@theme {
  /* --color-brand: oklch(0.6 0.2 250); */
  /* --font-display: "Inter", sans-serif; */
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
