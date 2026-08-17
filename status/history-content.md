# Plan

See `plans/history-content.md` for full context/decisions/architecture. Summary:

Mirror every successful D1 write for entries/singletons/content-type schema
(excluding system/hidden types) into the same git repo already configured
for pages-source (`githubSync` singleton), as JSON under `content/`, commit
message prefixed `[CONTENT] `. Delivery is client-driven: D1 write still
returns immediately; the existing IndexedDB draft (entry or content-type)
is kept (not discarded) until the git commit round-trips, retried 3x
client-side, with a reset-to-prior-value confirm dialog on repeated failure.
History dialog gains Code/Content tabs (message prefix `[CODE]`/`[CONTENT]`).
Revert is out of scope for v1 (view-only).

# Status

**Done.** All 4 decisions implemented, typechecked (`bun run typecheck` clean),
and covered by a passing e2e spec exercising the full retry-then-reset flow
against a real (deliberately invalid-token) GitHub API call.

Server:
- `github-source-sync.ts`/`gitlab-source-sync.ts`: `commitPagesSourceChanges`/
  `getCommitDetail`/`readFileAtCommit` refactored into a shared core +
  path-validator param; new `commitContentChanges`/`getContentCommitDetail`/
  `readContentFileAtCommit` siblings scoped to a new `content/` root.
  `git-source-sync.ts` dispatch shim extended to match.
- `content-types/git-mirror.ts` (new): `GIT_MIRROR_EXCLUDED_TYPE_NAMES`
  (`role`/`user`/`githubSync`/`aiKey`/`memory`), `isGitMirrorEligible`,
  `redactSecretFields` (strips `password`/`secretkey` field values before
  anything is written to git, walking the same `EntryFieldNode` tree
  `encodeRelationIds` does).
- `routes/content-history.ts` (new): `GET` (list/commit-detail/file, scoped
  per-entry/schema, gated on that resource's own `view`/`setting` grant -
  no blanket `handler.ts` segment gate, same self-authorizing pattern
  `dry-http`/`pages-build` already use) + `POST` (one atomic commit per
  request, server re-fetches/redacts every value itself, never trusts the
  client). Wired into `handler.ts`'s `API_ROUTES`.

Client:
- `content-types/content-history-http-api.ts` (new): thin fetch client.
- `content-types/entry-git-sync.ts` (new): `syncEntryToGit`/
  `syncSchemaChangesToGit`-style retry (3x, short backoff), the global
  `pendingContentSyncs` signal queue + `resolvePendingContentSync`
  (reset/dismiss), and the `notConfigured` short-circuit (see bugs below).
- `ContentEntryEditor.tsx` `handleSave`/`handleDelete`: draft discard now
  deferred to `syncEntryDraftToGit`'s outcome instead of immediate.
- `PageBuilder.tsx` `saveAndPublish`'s entries loop: same defer treatment.
- `ApplyBuildDialog.tsx` `runApply` / `ContentTypeEditor.tsx` `handleDelete`:
  batched into one `[CONTENT]` commit via `syncSchemaChangesToGit`; no
  auto-reset on failure (schema rollback via re-migration is unsafe - stays
  pending + a toast instead, consistent with revert being view-only).
- `DryLayout.tsx`: renders the `pendingContentSyncs` reset `ConfirmDialog` -
  global/persistent since the triggering editor has usually already
  navigated away by the time a failed sync surfaces.
- `HistoryDialog.tsx`: Code/Content tabs (client-side bucket by `[CONTENT]`
  prefix), `[CODE]` prefix added to `PageBuilder.tsx`'s `commitMessageFor`.
- `ContentHistoryDialog.tsx` (new, `src/components/`): read-only per-entry/
  schema history, "View history" wired into `ContentEntryEditor.tsx`
  (topbar + VEI-dialog variant) and `ContentTypeEditor.tsx`.

Two real bugs found and fixed while writing the e2e test (not visible from
typecheck or manual reasoning - only surfaced by actually exercising the
"git not configured" and "git configured but list fails" cases):
1. A tenant that has NEVER configured git would have had every single save
   retry 3 times (~5s) and then pop the reset dialog, since the original
   code treated "not configured" as an ordinary failure. Fixed: the 412
   `content-history.ts` returns for a missing token now short-circuits the
   client's retry loop as an immediate no-op success (`notConfigured` flag,
   `content-history-http-api.ts`/`entry-git-sync.ts`).
2. `ContentHistoryDialog.tsx` silently swallowed a real API error (e.g. a
   configured-but-bad token) whenever the server's `configured` flag was
   still `true` - fixed to surface `reason` regardless of `configured`.

e2e: `e2e/content-history.spec.ts` - ONE consolidated test (not several
independent ones, see the file's own doc comment) covering save-returns-
immediately timing, the History dialog's inline-error behavior, edit/delete
regression, no-History-button-on-a-new-entry, and the full retry-then-reset
flow (real GitHub 401 on a deliberately-invalid token, 3 retries, dialog,
Reset, confirmed the row is actually gone after). Passes in ~9-12s.

# Speed

Feature complete. While writing e2e coverage, hit + fixed 2 more pre-existing,
UNRELATED infra issues (both confirmed fixed by re-running the suite):
- A fresh Super Admin is force-redirected to `/dry/github-setup` on every
  navigation until a repo/branch is saved (`routers/App.tsx`) - blocked ALL
  e2e specs that touch any real admin page, confirmed via an untouched spec
  (`content-type-editor.spec.ts`) hitting the identical redirect in
  isolation. Fixed in `e2e/global-setup.ts`: the standard e2e account
  bootstrap now also saves a `githubSync` repo/branch/token (deliberately
  invalid token, never a real credential) right after registering, so every
  spec starts past the gate.
- `scripts/dev-server.mjs`'s `closeExistingDevServer()` matched ANY other
  `dev-server.mjs` process by command line regardless of port - starting
  the e2e server (a different port) silently killed a concurrent `bun run
  dev`; confirmed live (it killed this session's own dev server mid-task).
  Fixed to match by the actual port about to be bound (`lsof -ti :$PORT`)
  instead - verified a normal `bun run dev` now survives a full e2e run.

One follow-up NOT done (out of scope for this pass): no unit-level (vitest)
coverage of `entry-git-sync.ts`'s retry logic in isolation (only reachable
indirectly via the e2e path today).
