## Plan

- Add an `Apply Builder` action to each Content Types row with a pending draft.
- Reuse `ApplyBuildDialog`, scoped to the selected row while keeping the existing
  all-drafts action unchanged.
- Add the same review/apply action to the Builder page header, using the page's
  live content-type list as the dialog baseline.
- Verify typecheck, tests, and production build.

## Status

- Completed: Content Types row flow and Builder header integration both reuse
  the staged review/apply dialog.
- `bun run typecheck`, `bun run test`, and `bun run build` pass.
- Authenticated Playwright E2E was not run because `E2E_EMAIL` and
  `E2E_PASSWORD` are not configured in this environment.

## Speed

- No blockers.
