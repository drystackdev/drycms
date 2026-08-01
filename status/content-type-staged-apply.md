# Content Types: staged drafts + "Apply and build"

## Plan

Rework the Content Types schema editor from "Save = apply immediately" to a
staged-draft model, per user spec:

1. Editing a Collection/Singleton/Component's schema and clicking Save no
   longer applies the migration - it stores a local draft only.
2. `ContentTypes.tsx` (the list page) gets an "Apply and build" block below
   the kind nav list, visible only when at least one draft is pending
   (across all 3 kinds).
3. Each row's field-count badge becomes an "edited fields" count (diff
   between live definition and its pending draft, 0 if none).
4. Clicking "Apply and build" opens a dialog: (a) review stage - lists every
   pending type's field-level changes, purely client-computed; (b) confirm
   triggers a server dry-run (`mode: "plan"`, no DB writes) showing a
   waiting screen; (c) once the dry-run returns cleanly (or with destructive
   warnings), the real "Save" button unlocks and calls the server again
   (`mode: "apply"`) to actually run the migrations.

Design decisions locked in with the user:
- Drafts persist in **localStorage** only (not server-side) - simplest,
  no DB schema change, accepted tradeoff: drafts don't sync across
  devices/browsers.
- Build flow is **dry-run-then-save** (not confirm-applies-immediately).
- "Apply and build" always covers **all three kinds at once**, one dialog,
  one batch call - matches its placement below the kind nav (not per-tab).

Reused instead of rebuilt: `adapter.planSave()` is already a pure dry-run
(migration.ts's `planMigration`/`planSave`), and `adapter.applySave()`
already re-verifies each type's version before writing - so the batch
endpoints are thin loops over the existing per-type `handleSave` logic in
`routes/content-types.ts`, not new migration engine code.

Explicitly out of scope (confirmed not requested): server-side draft
storage, per-kind (vs all-kind) apply, changing Delete to also stage/defer,
changing the kind-nav badge counts (top-level Collection/Single/Component
counts stay total-item counts, not pending-edit counts).

## Status

Done. All steps implemented, tested, and manually verified against the live
dev server.

- [x] Investigated current architecture - immediate-apply confirmed, no prior
      draft concept.
- [x] Design decisions confirmed with user (localStorage, dry-run-then-save,
      all-kinds-at-once).
- [x] `src/content-types/draft-diff.ts` - pure diff helper (`diffContentType`,
      `describeDestructiveChange` handling both SQL's `DestructiveChange` and
      the file engine's `FileDestructiveChange`).
- [x] `src/content-types/draft-store.ts` - localStorage-backed
      `@preact/signals` store (`drafts` signal, `saveDraft`/`getDraft`/
      `discardDraft`/`discardDrafts`).
- [x] `src/server/routes/content-types.ts` - `performSave` extracted (adds a
      `dryRun` mode) + `handleBatch` batch plan/apply, reached via `POST`
      sending `{ mode, drafts }` instead of `{ definition }`. Sequential apply
      re-reads live state per item, so same-batch cascades (e.g. a component
      draft + one of its dependents) land consistently.
- [x] `src/content-types/http-api.ts` - `planBatch`/`applyBatch`.
- [x] `ContentTypeEditor.tsx` - Save writes to draft-store only; loads
      draft-over-live on mount (including reopening a not-yet-created draft
      via its own `/:id/edit` url); mirror-field delete now stages a draft
      instead of calling the API; added a "Discard draft" action; removed the
      old per-save destructive-confirm dialogs (that review moved into the
      batch dialog).
- [x] `ContentTypes.tsx` - not-yet-created drafts render as rows; "Edited"
      badge replaces the old field-count badge; "Apply and build" block below
      the kind nav, visible whenever any draft is pending across any kind;
      `useFetch`'s `reload()` wired to `ApplyBuildDialog`'s `onApplied` so the
      table picks up a newly-applied type without a remount.
- [x] `ApplyBuildDialog.tsx` - review (client-only diff) -> checking (server
      dry-run) -> checked (ready/error) -> applying -> applied. Diff view is
      snapshotted at dialog-open time so an applied item's own change list
      doesn't collapse to "no changes" once the post-apply reload lands.
- [x] CSS - `.content-types-apply-block`, `.apply-build-dialog[open]` /
      `.apply-build-body` (added to `components.css`).
- [x] Typecheck clean. 658/664 tests pass (6 pre-existing unrelated
      `options.test.ts` failures from leaked `GITHUB_*` env vars in this
      shell, confirmed present on `master` before this work too). Added 6
      route-level batch tests (`content-types.test.ts`) + 17 `draft-diff`
      unit tests.
- [x] Manual smoke test via Playwright against the live dev server (real
      login): create-as-draft -> list shows Draft badge + Apply-and-build
      block -> review dialog -> dry-run -> apply -> list refreshes live,
      draft cleared. Also exercised the plan-mode error path (name
      collision) and confirmed apply is correctly withheld until errors
      clear. Found and fixed two real bugs in the process (see below). Test
      collections deleted afterward, dev data left clean.

## Bugs found and fixed during manual testing

1. Dev server had been running since well before this session's edits -
   `scripts/dev-server.mjs` calls `vite.ssrLoadModule` exactly once at boot,
   so `src/server/**` edits after that don't take effect without a restart
   (unlike client code, which HMRs normally). Restarted it to pick up the
   route changes; not a bug in the change itself, but worth remembering next
   time a route edit "isn't working" in this repo.
2. `ContentTypes.tsx`'s own `useFetch` list wasn't refreshing after a
   successful apply - `bumpContentTypesVersion()` is only watched by the
   sidebar (`DryLayout.tsx`), not by this page's own fetch. Fixed by passing
   `reload()` through as `ApplyBuildDialog`'s `onApplied`.
3. Once (2) was fixed, the dialog's own diff view started recomputing against
   the freshly-reloaded live data mid-dialog, making a just-applied item's
   change list collapse to "No field changes" right as the success screen
   appeared. Fixed by snapshotting `liveDefinitions` at dialog-open time
   (`liveSnapshot` state), same as the existing `items` snapshot.

## Speed

Completed in one session. Backend reuse (`planSave`/`applySave` were already
dry-run/apply-separated) kept the server side small; most of the effort was
the two page rewrites, the new dialog, and the manual browser verification
loop that caught the two reload bugs above.
