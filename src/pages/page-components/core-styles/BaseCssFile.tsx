import { LockIcon } from "../../../components/icons/index.js";

/** Recreated verbatim if `styles/base.css` is ever found missing - see
 * `GlobalsCssFile.tsx`'s doc comment. This is deliberately a small set of
 * site-wide, accessible defaults; component styling stays in utilities. */
export const DEFAULT_CONTENT = `@layer base {
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
