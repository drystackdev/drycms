# Plan

- Turn the empty Visual Editing panel into a Collection/Singleton chooser.
- Reuse the existing collection list and entry/singleton editor inside the VEI frame.
- Restore Back navigation within the VEI flow.
- Relay field focus to the preview and scroll/highlight the first matching `data-dry-*` marker.
- Add focused tests and run typecheck.

# Status

Complete. Implemented the content-type chooser, embedded Collection lists, Singleton/full entry editing, VEI-preserving routes, Back navigation, and field-focus relay to the first matching preview marker. Also fixed opaque-preview CORS for Vite optimized dependency imports whose fetch destination is `empty`. Typecheck, focused CORS/preview tests, the earlier full 1,435-test run, and `git diff --check` pass.

# Speed

Finished on pace. The existing entry/list screens and field-focus events were reused; no parallel content editor was introduced. Browser visual QA remains unavailable because no browser session is connected.
