# Plan

- Clear the browser page-source IndexedDB cache before resetting server state.
- Clear page-source and built-page storage plus `_pages`/`_page_deps` state.
- Restore the deployed mock, push GitHub when available, repopulate IndexedDB, and build all pages.
- Report success only after the build completes; cover storage/registry behavior with tests.

# Status

- Full reset flow implemented.
- Server now recursively clears root entries, writes the mock, and verifies
  every file byte-for-byte before returning `applied: true`.
- An initial IndexedDB clear failure no longer prevents the server reset;
  the strict full-cache replacement still has to succeed before the UI can
  report success.
- GitHub sync is best-effort and reports a skip reason without blocking storage/cache reset or build.
- SQLite and D1 registry reset tests pass; targeted suite (49 tests), typecheck, and diff validation pass.

# Speed

- Complete. No blockers.
