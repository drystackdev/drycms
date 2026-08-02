# Builder Content Type manual tests

## Plan

- Cover the manual Builder flow without depending on the unfinished AI flow.
- Verify draft creation, schema apply/build, and collection entry CRUD.

## Status

- Added an E2E test for creating a Collection from Builder, applying its draft,
  creating an entry, and deleting that entry.
- Fixed the embedded editor so its Save draft action is available in Builder.
- The test logs in through `E2E_EMAIL`/`E2E_PASSWORD`; credentials are not
  stored in the repository.
- Verified successfully against the local dev server.

## Speed

- Completed in one pass after aligning the assertions with the entry-create
  redirect behavior.
