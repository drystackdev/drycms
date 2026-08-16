# Plan

1. Audit the existing dock, entry-draft preview/save, affected-page rebuild, and component preview flows.
2. Turn VEI and Code into mutually-exclusive, toggleable right-panel modes with Solar icons.
3. Add an XL Save preview dialog covering dirty source files and edited entries.
4. Implement one Save pipeline: source files, entry drafts, affected-page rebuild, with staged percentage progress.
5. Constrain component editor dialog height and make its preview a runnable `xs` viewport matching Page Editor behavior.
6. Typecheck, test, build, and visually verify the full workflow.
7. Polish the compact dock and keep the VEI editor iframe alive between selected fields.
8. Persist the active builder context, hydrate preview data from entry drafts, and add per-item Save review controls.
9. Bound the component-file dialog to the viewport and place its xs preview left of the code editor.
10. Reuse VEI's field-diff dialog for content previews and badge Save with the unique pending-item count.

# Status

- Audit complete: entry drafts can be saved through `entries-http-api`, data dependencies through `pages-build?byResource`, and source dependencies through each build result's `sourcePaths`.
- Complete: mutually-exclusive VEI/Code dock modes, runtime VEI toggle with Shift+Click escape, unified Save preview/pipeline, and constrained runnable `xs` component preview.
- Verification complete: focused tests, typecheck, and production build pass.
- Complete: icon-only Save/selected primary states, VEI empty Cancel, and bridge-based VEI navigation remove panel reload jitter.
- Complete: pen/Save icons, stable primary hover, no Exit, reload recovery, and compact one-column Save review with per-item Preview/Revert.
- Complete: component dialog uses fixed header/body/footer rows with internal overflow containment; preview is the left column.
- Complete: Save content Preview opens the shared VEI review dialog; Save icon shows a top-right pending count badge.
- Complete: Save badge uses an opaque, theme-aware background with a separating border and shadow.
- Complete: VEI string boxing is idempotent, preventing read-only character-index assignments during route changes.
- Complete: an already-open repeatable-item dialog resyncs when the entry's IndexedDB draft finishes hydrating after reload.
- Complete: reverting the final field in Save Preview discards the draft and immediately clears its VEI override, row, Preview action, and badge count.
- Complete: route layouts are listed below the code panel; layout/component dialogs share responsive xs-xl preview, zoom/Fit controls, and header-only actions.
- Complete: browser title follows the rendered page title as `<Page title> - Page builder`.
- Complete: layout/component dialog mirrors code-page-editor with a realtime draggable preview/code split and a compact preview-local viewport/zoom toolbar.
- Complete: the code-panel layout footer renders its root-to-leaf chain as chevron-separated breadcrumbs.
- Complete: removed the preview panel's duplicate border beside the dialog resize handle.
- Complete: dialog preview scrolling uses the app's OverlayScrollbars theme while sharing its viewport with Fit measurement.

# Speed

- Completed without blockers; icon generation, typecheck, focused tests, and production build pass.
