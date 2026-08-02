# Plan

- [x] Map architecture and dependency boundaries.
- [x] Scan for dead code, duplicated configuration, and high-risk code smells.
- [x] Run typecheck, build, unit tests, and targeted runtime checks.
- [x] Summarize findings by priority with recommended cleanup scope.

# Status

Audit complete.

Findings:

- Core checks pass: typecheck, 55 unit-test files / 588 tests, production build,
  and public-route runtime checks.
- E2E setup is incomplete after auth: 26/26 E2E tests failed without
  `E2E_EMAIL`/`E2E_PASSWORD`; most specs have no shared authenticated fixture.
- `.gitignore` ignores `e2e`, leaving the newer builder E2E spec untracked.
- `createApiMiddleware()` forwards errors through `next(error)`, while the Node
  dev and production callers ignore that argument; unexpected API failures can
  leave a request without a response.
- `package.json` still declares `workspaces: ["packages/*"]` although the
  standalone app has no `packages/` tree.
- The Showcase chunk is intentionally lazy but large (~2.9 MB); FileManager and
  the global stylesheet are also large maintainability candidates, not current
  correctness failures.

# Speed

Progress: 4/4 phases complete.
Blockers: E2E credentials are intentionally not stored in the repository.
