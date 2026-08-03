# CodeEditorField

## Plan

- Add a controlled `CodeEditorField` component backed by `prism-code-editor`.
- Add the component to the Showcase field-input demos with an editable example.
- Verify typecheck, tests, and the rendered showcase interaction.

## Status

- Complete: added the controlled field, Showcase demo, drycms token styling, and `prism-code-editor` dependency.
- Verification: typecheck, production build, unit tests, and direct Playwright UI checks pass. The full E2E suite has unrelated failures caused by the existing Vite WebSocket port collision and missing seeded content-type expectations.

## Speed

- No blockers. The existing `CodeField` remains unchanged; this task adds the richer editor as a separate field.
