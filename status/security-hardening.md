# Security hardening review

## Plan

- Protect system records and admin-only API mutations at the server boundary.
- Harden AI outbound requests, sessions, rate limiting, and request sizes.
- Validate relation integrity and add regression coverage.

## Status

- Patched server-side privilege escalation, admin API authorization, AI outbound URL/key handling, request limits, refresh-token consumption, relation existence checks, rate-limit spoofing, and internal error leakage.
- Added regression tests for URL validation, body limits, refresh rotation, and role escalation.
- Verified with `bun run typecheck`, `bun run test`, `bun run build`, and `git diff --check`.

## Speed

- Review findings were patched without overwriting unrelated working-tree changes.
