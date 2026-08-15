# Code editor cache / apply-build / AI-MCP review

## Plan

- [x] Trace Page Editor draft/cache ownership and automatic invalidation.
- [x] Trace Apply/Build from UI through API, storage publication, and cache refresh.
- [x] Compare in-app AI writes and MCP writes against those invariants.
- [x] Implement MCP/open-editor reconciliation and failure-safe cache reload.
- [x] Persist off-screen Magic Chat edits and clear dependency AI flags after publish.
- [x] Re-check Content Type local/AI draft, conflict, Plan/Apply, and cleanup flows.
- [x] Add regression coverage and run focused tests/typecheck/E2E.

## Status

- Fix implementation complete.
- Confirmed working:
  - Page Editor keeps saved-source cache and unsaved drafts in separate IndexedDB databases.
  - On mount/reload, a draft with `baseSource` differing from fresh server content is discarded.
  - Save/Build saves every dirty file first; Build uses the returned fresh map, not stale React state.
  - MCP schema proposals remain staged and go through plan -> apply; successful items alone are removed.
- Findings:
  1. Critical: an MCP write while Page Editor remains open only changes a red-dot flag. The editor does not refresh the file or establish a conflict. Saving its old buffer can overwrite the MCP write and `PUT /pages-source` then clears the warning flag.
  2. High: `loadTree()` converts every individual read failure to an empty string. A transient failure can therefore replace visible/saved/cache content with `""` and classify a real local draft as stale, deleting it.
  3. Medium: Magic Chat writes to a non-selected file are memory-only until Save; no IndexedDB draft is written. A reload/crash can lose those AI edits, unlike edits to the selected file.
  4. Medium: publishing a page clears only the AI flag for its `entryPath`. Building all after an MCP change to a shared layout/component/style can publish that change while its red warning remains indefinitely until that exact source file is explicitly saved.
  5. Low: MCP's success text mentions a `pages-build` tool, but no such MCP tool is registered; only Page Editor build and `preview_page_source` exist.
- Coverage gap: existing tests cover flag persistence/API behavior and the build pipeline, but not live MCP-write vs open-editor conflict handling, cache/draft invalidation under read failure, non-selected Magic draft recovery, or dependency-flag clearing after Build all.
- Implemented:
  - AI-flag polling reloads MCP-written files into the open editor, updates the saved cache, drops stale local drafts, and adds newly-created MCP paths to the tree.
  - Page Editor saves now carry a SHA-256 baseline; the server returns 409 rather than overwriting a newer storage copy even if Save beats the 25-second poll.
  - Whole-tree reload aborts on a file read failure instead of treating failure as empty source.
  - Magic Chat writes to non-selected files now persist to the page-source draft IndexedDB.
  - Build publish carries the actual TS/TSX and imported Tailwind stylesheet source graph and clears AI flags for every source that reached live output.
  - Corrected MCP guidance to stop referring to a nonexistent `pages-build` MCP tool.
- Content Type re-check:
  - MCP proposals remain server-staged until browser sync; local conflicts require an explicit keep/overwrite choice.
  - Plan remains non-mutating; Apply discards only successful items, retains failures, bumps the live version, and clears successful AI staging entries.
  - Reset one/all clears local draft records and AI staging entries.
  - Deep follow-up found and fixed a cross-user isolation bug: proposal bodies were keyed only by content-type id even though their indexes were per-user. Bodies are now keyed by user + draft id, so two admins proposing the same schema cannot read, overwrite, or delete each other's proposal.
  - Server draft expiry now prunes the per-user index and bumps its version; the browser removes local AI mirrors absent from an authoritative changed server payload, preventing expired/applied-elsewhere drafts from reappearing forever.
- Verification:
  - 87 focused Vitest tests passed after the final changes.
  - `bun run typecheck` passed; `git diff --check` passed.
  - Playwright: MCP Content Type Apply, MCP Content Type Reset, and Page Editor save/reload/build all passed (3/3).
  - Deep Content Type follow-up: 57 focused tests passed, including same-id cross-user isolation and TTL cleanup; Content Type MCP Playwright passed again (2/2).

## Speed

- Completed 2026-08-15. No blocker.
