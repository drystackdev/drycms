# E2E test infrastructure

## Plan

- Reproduce the current `test` and `test:e2e` failures.
- Make Playwright own the dev-server lifecycle and run against disposable data.
- Bootstrap a shared authenticated storage state for every E2E spec.
- Run unit tests, typecheck, and the full E2E suite.

## Status

- Unit suite reproduced and passed: 55 files, 589 tests.
- E2E failure reproduced: no server on port 5173 and one spec required unset credentials.
- Implemented an isolated E2E server, automatic first-admin bootstrap/login, and shared Playwright storage state.
- Updated stale E2E assertions for the current Content Type, role-list, field-editor, cache, and RichText contracts.
- Full E2E verification passed: 21 tests in 10.5 seconds.
- Final verification passed: 56 unit-test files / 591 tests, `bun run typecheck`, and `git diff --check`.

## Speed

- Infrastructure and test updates are complete; no known test blocker remains.
