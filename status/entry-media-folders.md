# Per-entry media folders (`entry/<slug>/`)

## Plan

See full approved plan at
`/Users/kcoder/.claude/plans/federated-chasing-whistle.md`. Summary:

1. `src/content-types/entry-media-paths.ts` — isomorphic path helpers
   (`entryMediaFolderPath`, `tempEntryMediaFolderPath`).
2. `src/content-types/entry-media.ts` — server cascade helpers
   (`syncEntryMediaFolder`, `removeEntryMediaFolder`), mirroring
   `redirects.ts`'s `recordSlugRedirect` pattern.
3. Wire cascades into `src/server/routes/content-entries.ts` POST/PUT/DELETE.
4. Hide `.tmp.*` folders from listings in `src/storage/local.ts` +
   `src/storage/r2.ts` (extend the existing `.dir` marker filter).
5. `src/storage/scoped-source.ts` — `scopeFileSource()` wrapper, sandboxes a
   `FileManagerSource` to one subfolder.
6. `src/pages/content-entry-editor/entry-media-context.ts` — Preact context
   threading `{ collectionName, slug, isNew }` from `ContentEntryEditor.tsx`
   down; consumed in `ScalarField.tsx` to build a scoped `entrySource`.
7. `src/components/FileManager/EntryScopedPicker.tsx` — new Entry/Media tab
   bar, wired into `FileField.tsx`, `ImageField.tsx`, and RichText's
   `image-menu.tsx`. Also fixes a prerequisite gap: `ScalarField.tsx`
   currently passes no `source` at all into `RichTextField` for the
   richtext field type.
8. Unit tests for `entry-media.ts` + `scoped-source.ts`; `bun run
   typecheck` + `bun run test`; manual Playwright QA (new entry → tmp
   folder hidden → save → moves to `entry/<slug>`; slug rename → folder
   rename; delete → folder removed; RichText picker now works at all;
   no-slug types see zero behavior change).

## Status

All 8 implementation steps done:

1. `src/content-types/entry-media-paths.ts` - `entryMediaFolderPath`,
   `tempEntryMediaFolderPath`.
2. `src/content-types/entry-media.ts` - `syncEntryMediaFolder`,
   `removeEntryMediaFolder`.
3. Cascades wired into `src/server/routes/content-entries.ts` POST/PUT
   (singleton+collection)/DELETE.
4. `.tmp.*` hidden in `src/storage/local.ts` + `src/storage/r2.ts` (extended
   the `.dir`-marker filter).
5. `src/storage/scoped-source.ts` - `scopeFileSource()`.
6. `src/pages/content-entry-editor/entry-media-context.ts` +
   `ContentEntryEditor.tsx` provider + `ScalarField.tsx` consumer.
7. `src/components/FileManager/EntryScopedPicker.tsx`, wired into
   `FileField.tsx`, `ImageField.tsx`, and the whole RichText picker chain
   (`field.tsx` -> `toolbar.tsx`/`image-menu.tsx` -> `image-insert-button.tsx`/
   `dry-component-insert-button.tsx`/`dry-component-menu.tsx`/
   `dry-component-props-form.tsx`) - this also fixed the prerequisite gap
   where `ScalarField.tsx` passed no `source` into `RichTextField` at all,
   so richtext's image/component-image pickers were previously dead.
8. Unit tests added: `entry-media.test.ts`, `scoped-source.test.ts`, a
   `.tmp.*`-hiding case in `local.test.ts`. Fixed `content-entries.test.ts`'s
   `../config.js` mock (needed a `storage` export once the route started
   importing it).

Verification:
- `bun run typecheck`: clean for every file this feature touched. 9
  pre-existing errors remain in `src/apps/pages/blogs/page.tsx` and
  `src/pages/content-entry-editor/FieldRenderer.tsx` - unrelated files
  under active concurrent edit by another session (confirmed via `git
  diff`, not part of this change).
- `bun run test`: all touched/added test files pass (`entry-media.test.ts`
  8/8, `scoped-source.test.ts` 6/6, `local.test.ts` 24/24,
  `content-entries.test.ts` 11/11). Full-suite run has 16 pre-existing
  failures across `seed.test.ts`/`entries-sqlite.test.ts`/`sqlite.test.ts`/
  `content-types.test.ts` - all from the same concurrent session's
  in-progress seed data changes (new `about`/`blog`/`homepage`/etc content
  types), unrelated to this feature.
- Manual/Playwright QA NOT completed: the shared Playwright browser
  profile was already in use by the other concurrent session
  (`Browser is already in use for .../mcp-chrome-c45ac02`), so interactive
  UI verification was skipped rather than forcing it. Confirmed instead via
  curl that the already-running dev server (port 5173, not started by this
  session) serves `/dry` (200) and `/dry/api/storage` (expected
  auth-gated JSON) without a 500 from the new `content-entries.ts` imports.

## Speed

Implementation + unit tests + typecheck/test verification done in one
sitting. Interactive browser QA is the one remaining item, blocked on the
other concurrent session's Playwright browser profile being free.
