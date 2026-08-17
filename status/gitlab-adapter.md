# Plan

- Extend the built-in Git sync configuration with provider and GitLab URL fields, including safe upgrade handling for existing databases.
- Add provider-aware Git smart-HTTP proxying and connection validation.
- Add a GitLab repository adapter for commit/history/read/reset operations and route existing callers through the selected provider.
- Update the settings UI and user-facing labels, then add focused tests and run typecheck/unit tests.

# Status

- Complete: the setup/settings form now selects GitHub or GitLab and shows a GitLab URL field defaulted to `https://gitlab.com`.
- Complete: provider configuration is persisted without a database schema migration; existing GitHub values remain backward compatible.
- Complete: smart-HTTP clone/fetch/push, validation, source commits, history, file reads, restore, and reset dispatch through the selected provider.
- Complete: GitLab custom URLs pass the existing outbound URL/SSRF checks; GitLab repositories must have an initialized default branch.
- Verified: typecheck and the full unit suite pass (149 files, 1431 tests). Focused tests cover provider serialization, config loading, Git proxy targeting, and GitLab commit requests.
- Visual browser QA was unavailable because no browser session was connected.

# Speed

- Completed in one implementation pass; no blockers remain in code or tests.
