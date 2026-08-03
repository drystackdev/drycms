# Server organization refactor

## Plan

- Remove duplicated JSON and Super Admin authorization helpers.
- Share schema/entry adapter resolution across server routes.
- Verify the session token once per API request.
- Correct the auth-security documentation and persist bulk-revocation reasons.
- Run typecheck and the relevant unit tests, then review the final diff.

## Status

- Completed all six findings.
- Shared `jsonResponse`, Super Admin authorization, and content adapter resolution.
- Reused pre-verified JWT claims, corrected the session revocation comment, and persisted bulk-revocation reasons.
- Validation complete: typecheck, full unit suite, and production build pass.

## Speed

- No blocker. Existing user change in `vite.config.ts` is being left untouched.
