# Builder Content Type manual tests

## Plan

- Cover the manual Builder flow without depending on the unfinished AI flow.
- Verify draft creation, schema apply/build, and collection entry CRUD.

## Status

- Added an E2E test for creating a Collection from Builder, applying its draft,
  creating an entry, and deleting that entry.
- Fixed the embedded editor so its Save draft action is available in Builder.

## Speed

- Pending Playwright verification against the running dev server.
