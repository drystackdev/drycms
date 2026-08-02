# Server security audit

## Plan

- Map the server request/auth/route flow and read the repository security-relevant design notes.
- Review storage, content, auth/session, AI, proxy/adapter, and input-validation boundaries.
- Run the existing test/typecheck/dependency checks and verify each finding against exact source locations.
- Deliver severity-ranked findings with concrete remediation guidance.

## Status

- Completed architecture and coding-principles review.
- Completed source review of all `src/server` routes, adapters, auth/session, CSRF/rate limits, storage boundary, and relevant content/storage engines.
- Verification complete: typecheck passed, production build passed, 55 test files / 585 tests passed, and `bun audit` reported two High advisories through the Vite/Preact build chain.
- Findings to report: generic SVG upload XSS, publish permission bypass, first-admin bootstrap takeover/race, spoofable Node rate-limit IP header, DNS-rebinding SSRF hardening gap, proxy-origin/security-header hardening gaps, and unbounded resource usage on authenticated admin endpoints.

## Speed

- Progress: broad source audit complete; focused verification remains.
- Blockers: none; no source-code remediation was requested, so this audit did not modify application code.
