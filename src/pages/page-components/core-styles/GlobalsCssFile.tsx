import { LockIcon } from "../../../components/icons/index.js";

/** Recreated verbatim if `styles/globals.css` is ever found missing
 * (`PageEditor.tsx`'s `loadTree`) - matches what a fresh `styles/` folder
 * needs day one: the Tailwind import plus the other 2 core files, in the
 * order `vite.config.ts`'s build (and `@source`, for class-name scanning)
 * expects. */
export const DEFAULT_CONTENT = `@import "tailwindcss";

@import "./theme.css";
@import "./base.css";

@source "../../../.dry/pages-source";
`;

/** One of the 3 small "what is this built-in file" cards shown in the Page
 * Editor's System tab (`SystemFilesPanel.tsx`) - purely descriptive, no
 * actions of its own (the panel wraps an "Open in Styles" button around
 * whichever of these render). */
export default function GlobalsCssFile() {
  return (
    <div class="page-editor-core-style-file">
      <LockIcon class="page-editor-core-style-file-icon" aria-hidden="true" />
      <div>
        <h4>globals.css</h4>
        <p>
          The Tailwind build entry - <code>vite.config.ts</code> compiles this exact filename, and it
          imports <code>theme.css</code> and <code>base.css</code> by name.
        </p>
      </div>
    </div>
  );
}
