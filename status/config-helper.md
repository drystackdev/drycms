# Plan

- Add a typed `config({})` factory for `dry.config.ts`.
- Keep normalization and validation centralized in `resolveOptions()`.
- Add unit coverage and run typecheck/tests.

# Status

- Implemented `config(options)` and migrated the root config to use it.
- Added tests covering identity and the default call.
- Typecheck and focused `config` tests pass.
- The full options test file still has 5 pre-existing environment-sensitive
  failures because the workspace `.env` supplies `GITHUB_*` values.

# Speed

- Scope: small API ergonomics change; no runtime behavior change expected.
- Blockers: none for the implementation; full test suite needs isolated env
  handling for the existing GitHub tests.
