# Plan

- Add proactive refresh for the 15-minute session token.
- Refresh and retry authenticated API requests after a 401, including GETs.
- Keep refresh disabled when no CSRF/session cookie is present and validate with tests/typecheck.

# Status

- Mapped login, session, refresh-token rotation, and the global fetch interceptor.
- Added a 10-minute proactive refresh while the readable CSRF cookie exists.
- Added one-refresh-and-retry for all same-origin API requests after `401`.
- Added reload recovery in `store/auth.ts` when the short session cookie has expired.
- Verified with typecheck and the auth/session test set.

# Speed

- Complete. No blocker; unrelated working-tree changes were preserved.
