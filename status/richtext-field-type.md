# Plan

- Add the `richtext` field type to the content-type registry and field dialog.
- Render it in content entries with inline/non-inline behavior and configurable toolbar features.
- Treat empty block HTML as empty for required validation and add focused tests.

# Status

- Implemented registry, dialog, entry editor wiring, feature visibility, and block-mode required validation.
- Verification: `bun run typecheck` and `bun run test` pass (596 tests).

# Speed

- Completed without blockers.
