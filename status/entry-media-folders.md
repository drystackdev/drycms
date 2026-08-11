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

## Follow-up fix (2026-08-08)

User feedback: the Entry tab shouldn't nest inside ImageField's File tab -
it should sit flat alongside File/Link as one tab row. Fixed in
`ImageField.tsx`: dropped the `EntryScopedPicker` wrapper there, restored a
plain `FileManager`, and added "Entry" as a third top-level tab
(`activeTab: "entry" | "file" | "link"`) shown first when `entrySource` is
present, each tabpanel's `FileManager` only mounted while active (avoids
double `list()` fetch). `EntryScopedPicker` (Entry/Media flat two-tab) is
still used as-is in `FileField.tsx` and RichText's Replace/Insert-image
dialogs - those never had a second tab level to nest under, so they were
already flat.

## Follow-up fix (2026-08-12): picked entry images vanished + Magic

Three reports from `/dry/content/blog/new`: (1) an image picked on the Entry
tab didn't show on the field, (2) Magic Chat had no Entry tab, (3) "AI cũng
cần biết entry" - Magic should know the entry's own images.

Root cause of (1): `scopeFileSource` handed back PREFIX-STRIPPED ids
(`cover.webp`), so the value stored on the field wasn't a real storage path.
Nothing downstream could resolve it - not `ImageField`'s own name/thumbnail
lookup (which lists the FULL source), not `resolveImageSrc` on the public
site, not the server's `storage.stat()` checks. It looked like the pick was
simply ignored.

- `src/storage/scoped-source.ts` - ids stay absolute; only `parentId` is
  re-rooted (the scope's children read as `parentId: null`, which is all
  `FileManager` needs to treat it as its root - breadcrumbs walk `parentId`,
  never the id string). `toAbsoluteId` is idempotent, so a relative id
  stored before this change still resolves. Added `scopeRoot` (on
  `FileManagerSource`) + `isInScopeOf`, so a picker can tell "this pick is
  in the entry folder" apart from "somewhere else in Media".
- `src/hooks/useFileEntries.ts` (new) - the id→`FileEntry` resolution
  `ImageField`/`FileField` each had inline, now also consulting
  `entrySource`. Needed on its own: a NEW entry's `.tmp.*` folder is hidden
  from the storage tree, so ids inside it resolve ONLY through the scoped
  source.
- `ImageField`/`EntryScopedPicker` - reopening the picker onto a current
  pick lands on the tab that pick actually lives in (a new entry's staging
  folder is unreachable from "File").
- `MagicChat.tsx` - the attach-images picker is now an `EntryScopedPicker`
  (Entry/File, Entry first), not a bare `FileManager`.
- `entry-media-context.ts` - `useEntryMediaSource()` extracted from
  `ScalarField`, shared with `MagicChat` so both resolve the same folder.
- Magic knows the entry (3): `ai-magic-write.ts`'s `resolveEntryMedia`
  resolves the folder SERVER-side (stored slug for a saved entry, this
  admin's `.tmp.*` folder for a new one - never a client-claimed path),
  lists its images (`listEntryMediaImages`), adds them to
  `allowedImageSrcs`, and passes them to the prompt as their own section
  (`describeEntryMedia`) - deliberately separate from the "already shown to
  you" attached-images list, since the model only gets their names.

Verified: `bun run typecheck` clean; `bun run test` 1046 passed (the same 16
pre-existing failures as before this change - seed/dry-reader/engine specs,
untouched by it); `bunx playwright test` 22/22 including a new
`e2e/entry-media-picker.spec.ts` that uploads into a new entry's folder,
picks it, asserts the field renders `.tmp.<user>/cover.webp`, saves, and
asserts the value was rewritten to `entry/cover-test/cover.webp` - plus the
Entry tab in Magic's attach dialog.

## Speed

Implementation + unit tests + typecheck/test verification done in one
sitting. Interactive browser QA is the one remaining item, blocked on the
other concurrent session's Playwright browser profile being free.
