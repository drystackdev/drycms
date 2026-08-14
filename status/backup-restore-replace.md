# Plan

- Audit the existing SQL backup/restore contract for SQLite and D1.
- Validate a complete drycms dump before any destructive statement runs.
- Keep SQLite restore transactional; add recovery of the pre-restore state when a chunked D1 restore fails.
- Cover replacement, invalid/incomplete uploads, and failure recovery with unit tests; run focused tests and typecheck.

# Status

- Complete: restore validates the drycms signature and complete DROP/CREATE/INSERT structure before touching live data.
- Complete: SQLite keeps the full replacement in one transaction; D1 snapshots and restores the previous state after a failed chunked replacement.
- Complete: focused tests cover replacement, malformed/incomplete uploads, SQLite/D1 round trips, and simulated D1 mid-restore recovery.

# Speed

- Complete. Focused tests and TypeScript typecheck pass; unrelated working-tree edits were left untouched.
- Full suite reached two unrelated failures: an existing D1 entries assertion (`expected 2 to be 1`) and a dry-completions test timeout; all backup tests still passed in that run.
