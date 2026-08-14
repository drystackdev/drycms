# Page Editor functional test

## Plan

- Map the Page Editor's critical user journeys and existing test infrastructure.
- Exercise the real UI against the isolated Playwright server.
- Add repeatable end-to-end coverage for file editing, preview, save, reload, and build.
- Run the focused E2E test, typecheck, and relevant unit tests; document any product gaps found.

## Status

- Critical journey mapped: edit, dirty state, live interactive preview, save,
  persistence across reload, build, and public delivery.
- Added `e2e/page-editor.spec.ts`, using a dedicated temporary route and
  guaranteed cleanup so it does not alter the starter page or other specs.
- Fixed the E2E server leaking `EMAIL_ADMIN`/`PASSWORD_ADMIN` from a local
  `.env`; first-admin setup is now deterministic inside the isolated test DB.
- Focused Page Editor E2E passes. Full E2E run: 24 passed and one unrelated
  RichText IME setup test was flaky on its first attempt, then passed on retry.
- Typecheck passes. The 95 focused Page Editor/build/API unit tests pass.
- Complete.

## Speed

- Completed 2026-08-15. The only detour was making CSRF/HMR-aware fixture
  setup reliable both alone and after the preceding E2E specs.
