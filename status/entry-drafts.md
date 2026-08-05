# Entry drafts: IndexedDB autosave + preview + reset + nav/table indicators

## Plan

See /Users/kcoder/.claude/plans/ethereal-questing-squid.md for the full
approved design. Summary:

- New `src/content-types/entry-draft-db.ts` - raw IndexedDB CRUD (own DB
  `drycms-entry-drafts`), degrade-safely style like `src/lib/idb-cache.ts`.
- New `src/content-types/entry-draft-store.ts` - `@preact/signals`-backed
  lightweight index (`entryDraftIndex`) + `saveEntryDraft`/`loadEntryDraft`/
  `discardEntryDraft`/`hasEntryDraft`/`countEntryDrafts`/`draftKey`.
- New `src/content-types/entry-draft-diff.ts` - pure `diffEntryValue()`
  producing changed-field list (label/before/after) for the Preview dialog.
- New `src/pages/content-entry-editor/EntryPreviewDialog.tsx` - lg dialog,
  renders the diff list.
- `ContentEntryEditor.tsx` - load draft on mount (overrides server value),
  debounced autosave to IndexedDB while dirty, discard draft on successful
  Save, Preview button. Per-field reset and Reset All both live INSIDE
  `EntryPreviewDialog`, not on the field rows themselves (user correction,
  2026-08-05) - the outer form has no reset UI at all. Preview button itself
  only renders when `!isNew && isDirty` (user correction, 2026-08-05) - hidden
  on the New-entry creation view and hidden until there's at least one edit;
  its label always shows a `badge sm secondary` count of changed fields.
  Removed the "Discard unsaved changes?" leave-confirm (`leaveTo` state +
  `requestLeave`) AND the `beforeunload` native-prompt guard entirely (user
  correction, 2026-08-05) - now redundant since every edit is already
  autosaved to IndexedDB, so navigating away without saving no longer loses
  anything. Back/Cancel now call `route(backTo)` directly.
- Preview dialog auto-closes itself the instant `diffs` would go empty (last
  field reset via the dialog's own undo, or Reset all) - removed the "No
  changes yet" empty-state notice entirely, since it's now unreachable (user
  correction, 2026-08-05).
- `DryLayout.tsx` - hydrate index on mount; `ContentNavGroup` gets a
  `renderBadge` prop; singleton items get a `.nav-draft-dot`
  (`--dry-secondary-main`), collection items get a `badge sm secondary`
  count.
- `DataTable.tsx` - new `leadingColumn` prop (same shape as `dragReorder`'s
  pinned handle column) for the per-row draft dot.
- `ContentEntryList.tsx` - passes `leadingColumn` using `hasEntryDraft`.
- `components.css` - `.nav-draft-dot` rule + `badge sm secondary` variant.

Preview = changed-fields diff list (not full rendered preview). New-entry
drafts = single slot per content type (`${typeSlug}:__new__`), overwritten
on each fresh "New" visit. Both confirmed with user before planning.

## Status

Done. All pieces implemented and typechecked clean (`bun run typecheck`
shows zero errors in any touched/new file - the errors it currently reports
are pre-existing, in `src/apps/pages/{layout,page}.tsx`, owned by a
different concurrent session regenerating `dry.generated.d.ts`).

Playwright QA (isolated e2e server, fresh DB, dev server on :5173 never
touched) ran all 7 steps of the flow - autosave-survives-reload, sidebar
badge (collection)/dot (singleton), List page row dot, Preview dialog
diff+per-field reset, Reset all (with nested confirm), Save clearing the
draft everywhere - all PASS, no console errors.

## Speed

Complete.
