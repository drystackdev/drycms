# Plan

- Add an optional Preact SVG icon to `DryComponent` metadata.
- Render the configured icon in richtext pickers and component controls, with the existing component icon as fallback.
- Verify with tests, typecheck, and build.

# Status

- Complete: the icon is rendered to SVG markup and persisted in component JSON metadata; old records retain the fallback icon.

# Speed

- Completed in one implementation pass after switching from runtime loading to persisted SVG metadata.
