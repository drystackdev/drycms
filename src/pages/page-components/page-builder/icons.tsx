/** Local one-offs shared by Page Builder's own panels - same pattern as
 * `PageEditor.tsx`'s own inline icons (no shared export for a single-use
 * glyph elsewhere in the app). `OpenInNewTabIcon` is a literal copy of
 * `PageEditor.tsx`'s own (an arrow breaking out of a box, the standard
 * external-link glyph) - both `CodePanel.tsx` and `FileDialog.tsx` need it
 * for their "Open in Page Editor" escape hatch (`plans/
 * new-ui-page-builder.md` mục 12). */
export function OpenInNewTabIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 3a1 1 0 1 0 0 2h3.586l-7.293 7.293a1 1 0 0 0 1.414 1.414L19 6.414V10a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1zM5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V7h5a1 1 0 1 0 0-2z"
      />
    </svg>
  );
}
