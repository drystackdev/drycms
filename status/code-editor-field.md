# CodeEditorField

## Plan

- Add a controlled `CodeEditorField` component backed by `prism-code-editor`.
- Add the component to the Showcase field-input demos with an editable example.
- Verify typecheck, tests, and the rendered showcase interaction.

## Status

- Complete: added the controlled field, Showcase demo, drycms token styling, and `prism-code-editor` dependency.
- Follow-up complete: registered JSX/TSX autocomplete for HTML/JSX tags, attributes, identifiers, and Preact hooks/components; Build Component now supports `export default` Preact components.
- Follow-up complete: isolated the editor/autocomplete DOM and styles in an open Shadow Root.
- Follow-up complete: replaced the component icons with the supplied 14x14 SVG through the icon manifest.
- Verification: typecheck, production build, unit tests, and direct Playwright UI checks pass, including Shadow Root containment and JSX/Preact suggestions. The full E2E suite has unrelated failures caused by the existing Vite WebSocket port collision and missing seeded content-type expectations.

## Speed

- No blockers. The existing `CodeField` remains unchanged; this task adds the richer editor as a separate field.
