# Plan

- Convert the seeded `aiKey` content type from a sortable collection into a singleton with a sortable AI-key component list.
- Update seed tests and built-in type expectations.
- Verify the generic singleton UI route and the full test/typecheck suite.

# Status

- Complete: `aiKey` is now a hidden singleton with `name`, `description`, `sortPosition` (UI label: Position), and sortable repeatable `keys`.
- Complete: added hidden `aiKeyItem` component with Name, Description, Provider, URL, and write-only Key fields.
- Complete: the existing `/dry/content/aiKey` nav route now uses the generic singleton editor automatically; collection list behavior is gone for newly seeded schemas.
- Complete: file-engine boot upgrades an already-seeded legacy `aiKey` definition to the singleton definition in place; legacy record files are left untouched as a recoverable backup.
- Verified: focused schema/API/engine tests, typecheck, production client build, production server build, and `git diff --check` pass.
- Note: the full test run still reports unrelated environment-isolation failures in `secret-crypto.test.ts` and `server/options.test.ts`; all AI Key-related tests pass.

# Speed

- On track; no blockers.
