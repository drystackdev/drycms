# Builder UI

## Plan

- Replace the Builder placeholder with collection cards.
- Reuse the existing content-type API, draft store, field registry, and edit route.
- Verify typecheck, build, tests, and the local route.

## Status

- Implemented collection cards with label, table name, description, field count, and field-type icons.
- Added a native dialog that renders `ContentTypeEditor` directly in embedded mode, so the existing editor UI remains the single editing surface without an iframe or route navigation.
- Added responsive card/dialog styles.
- `bun run typecheck`, `bun run build`, and `bun run test --run` pass (580 tests before the embedded-mode-only adjustment; typecheck/build pass after it).
- Local Builder route responds with HTTP 200. In-app browser QA was unavailable because no browser backend was connected.

## Speed

- Completed in one pass; no code blockers.
