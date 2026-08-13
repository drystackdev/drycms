# MCP OAuth 2.1 Authorization Server

## Plan

See `/Users/kcoder/.claude/plans/wild-snuggling-brook.md` for the full
approved plan. Summary: add an OAuth 2.1 Authorization Server (discovery,
dynamic client registration, `/authorize` consent flow, `/token` code
exchange) so claude.ai web's remote MCP connector can authenticate against
`${basePath}/api/mcp`. An OAuth-issued access token is just an ordinary MCP
PAT minted via the existing `createMcpToken()` — no changes to `mcp.ts`'s
token-verification path itself.

Key files: `src/server/oauth-metadata.ts` (new, bare-root `.well-known/*`
documents), `src/server/routes/oauth.ts` (new, `authorize`/`register`/
`token`/`consent`/`consent-info`), `src/pages/OAuthConsent.tsx` (new consent
screen), plus edits to `handler.ts`, `csrf.ts`, `mcp.ts`, and `routers/App.tsx`
(`AuthGate` gains `return_to` support — fixes a latent `url`-vs-`path`
comparison bug in the process).

## Status

- [x] `oauth-metadata.ts` + wire into `page-handler.ts`
- [x] `routes/oauth.ts` (register/authorize/token/consent/consent-info)
- [x] `handler.ts` wiring
- [x] `csrf.ts` slug-scoped exemption
- [x] `mcp.ts` `WWW-Authenticate` header — turned out to need a matching fix
      in `handler.ts`'s own blanket 401 too, since that fires first for a
      real unauthenticated `mcp` request; `mcp.ts`'s own check is dead code
      for real traffic (only reachable via a direct-call unit test).
- [x] `AuthGate` `return_to` support + `url`-vs-`path` bug fix
- [x] `OAuthConsent.tsx` page + route registration
- [x] Unit tests (`oauth.test.ts`, 15 tests)
- [x] `bun run typecheck` / `bun run test` pass (1294/1294, no regressions)
- [x] Manual verification against a local `bun run dev` instance via curl:
      both discovery documents (bare-root + path-inserted), DCR
      `/register`, `WWW-Authenticate` header, and the anonymous
      `/authorize` → `/login?return_to=...` redirect (with binding cookie)
      all confirmed working.
- [x] Verified against real `workerd` runtime (`bun run dev:worker`,
      `localhost:8787`, real local D1/KV/R2 bindings, not Node fallbacks):
      discovery, `WWW-Authenticate`, DCR, anonymous `/authorize` redirect,
      and a garbage `/token` exchange (clean `invalid_grant`, no crash) all
      confirmed working on the actual Workers runtime.
- [x] Full server-side click-through verified against real `dev:worker`
      (`localhost:8787`), authenticated via the `DRYCMS_BOOTSTRAP_TOKEN`
      recovery login path (`.env`'s `EMAIL_ADMIN`/`PASSWORD_ADMIN` pair
      itself was still stale/401ing): register → `/authorize` (real
      session) → `/consent-info` → `/consent` approve → `/token` exchange
      → the issued `access_token` used as a real `Bearer` header against
      `/dry/api/mcp` → `tools/list` returned all 14 tools correctly. Only
      the literal claude.ai-web-UI click-through (needs a real deploy +
      that UI itself) is still outstanding, not the protocol/logic itself.
- [x] Regression check: a manually-created PAT (same
      `POST /api/auth/mcp-tokens` `McpConnect.tsx` uses) still authenticates
      against `/dry/api/mcp` (`ping` → `{}`) on the same running instance -
      OAuth changes didn't disturb the existing flow.
- [x] Same regression check re-confirmed on real production
      `dev.drystack.dev` with the user's own real PAT (`tools/list` → all 14
      tools).
- [x] **Real claude.ai web connector, end to end, against deployed
      `dev.drystack.dev`** - confirmed via `wrangler tail` while the user
      connected live: full `authorize`→`oauth/consent`(SPA page)→
      `consent-info`→`consent` approve→`token` sequence, all `Ok`.
- [x] **Root-caused the `client_id=Authorization` value** (an initial
      "stale cached client_id"/"UI placeholder field" theory was disproven
      once traced further): `wrangler tail --format json` showed claude.ai's
      OWN BACKEND (`user-agent: python-httpx`, `cf.asOrganization:
      "Anthropic, PBC"`) fetches both discovery documents (including a
      correctly-formed `registration_endpoint`) but NEVER calls
      `POST /register` - it unconditionally sends the fixed literal string
      `"Authorization"` as `client_id`. This is a real gap in claude.ai's
      current MCP connector (no DCR support yet), not something fixable
      from the user's side. Fixed server-side in `handleAuthorize`
      (`routes/oauth.ts`): an unregistered `client_id` now falls back to
      accepting any syntactically valid `https://` (or loopback)
      `redirect_uri` - same check `POST /register` itself enforces - PKCE
      still mandatory, consent screen still shows the real redirect host
      (not a client-supplied name). Added `oauth.test.ts` coverage for both
      the fallback-accept and the still-rejected (non-https) cases.
      Deployed to production (`bun run deploy`) and reverified live:
      `client_id=Authorization` + claude.ai's redirect_uri now gets a clean
      `302` instead of `400`.
- [x] `OAuthConsent.tsx` redesigned per user request: now rendered
      standalone by `AuthGate` (like `SignIn`/`RegisterSuperAdmin`, NOT
      inside `AuthenticatedApp`/`DryLayout`), a small centered card
      (`.oauth-consent-screen`/`.oauth-consent-card` in `components.css`)
      instead of a dashboard page. Error display switched from `toast.add`
      to an inline `.alert destructive` (the `Toaster` component only
      mounts inside `DryLayout`, which this page now deliberately skips -
      `toast.add` would have silently done nothing on this page otherwise).

## Speed

Started and code-complete 2026-08-14. Design fully validated via 2 rounds of
Explore + 1 Plan agent review before coding began (see plan file for the
confused-deputy security fix that came out of that review — binding cookie
on the authorize→consent flow). One real bug caught during manual
verification (the `WWW-Authenticate` header) that the unit tests, being
direct-call tests, couldn't have caught - only a curl against the real
dispatcher surfaced it. Also hit a known dev-server HMR gap (`handler.ts`
edits don't hot-reload - `scripts/dev-server.mjs` caches its Vite
`ssrLoadModule` exports at boot) - a full restart was needed to verify,
same class of issue as the existing "Server HMR misses new registry
entries" memory, now extended.
