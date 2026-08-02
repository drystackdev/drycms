# Server security audit

## Plan

- Map the server request/auth/route flow and read the repository security-relevant design notes.
- Review storage, content, auth/session, AI, proxy/adapter, and input-validation boundaries.
- Implement remediations and regression tests for confirmed findings.
- Run the existing test/typecheck/dependency checks and verify each finding against exact source locations.

## Status

- Completed architecture and coding-principles review.
- Completed source review of all `src/server` routes, adapters, auth/session, CSRF/rate limits, storage boundary, and relevant content/storage engines.
- Initial verification found 7 security issues plus two High Rollup advisories.
- Remediated generic SVG upload XSS, publish permission bypass, first-admin bootstrap takeover/race, spoofable Node rate-limit IP header, DNS-rebinding SSRF hardening gap, proxy-origin/security-header hardening gaps, and unbounded request/resource usage on authenticated admin endpoints (including AI stream concurrency).
- Added regression coverage for publish authorization and generic SVG uploads. First-admin bootstrap now requires `DRYCMS_BOOTSTRAP_TOKEN` and CSRF.
- Final verification: typecheck passed, production build passed, 55 test files / 588 tests passed, and `bun audit` reports no vulnerabilities.

## Speed

- Progress: remediation and verification complete.
- Blockers: none.
