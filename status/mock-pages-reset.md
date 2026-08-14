# Plan

- Replace the generated zip/base64 starter with a committed `mock/` source tree bundled directly by Vite.
- Add a GitHub Sync reset endpoint that snapshots the mock tree to GitHub and mirrors it to pages-source storage.
- Add the GitHub Sync settings action that refreshes IndexedDB and publishes every page after reset.
- Cover the seed/reset behavior with tests and run typecheck/unit tests.

# Status

- Added the committed `mock/` tree and switched both seed paths to its Vite-bundled raw manifest.
- Removed the generated zip/base64 script, generated module, and worker-build step.
- Added the GitHub Sync reset API and settings action; IndexedDB replacement and browser Build all are wired.
- Updated deployment guidance for the direct mock bundle/first-use seed.
- Verification complete: typecheck, focused tests, full unit suite (one transient completion-test timeout passed on immediate isolated rerun), and a Worker SSR bundle containing the mock source.
- 2026-08-14: Reset no longer requires GitHub Sync to be configured. In local/dev it replaces pages-source and publishes normally; when GitHub Sync is enabled, the remote snapshot remains a required first step.

# Speed

- Complete.
