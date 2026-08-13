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

## Follow-up: claude.ai "Connect" spins forever (2026-08-14)

Symptom (user): on `claude.ai/.../customize-connectors/<id>`, pressing
Connect → OAuth consent → Approve → claude.ai loads for a very long time and
never finishes, with no error shown.

Ruled out so far (full flow replayed against a local `bun run dev` with a
real session, timings in ms):
`authorize` 105ms → `consent` 6ms → `token` 6ms → MCP `initialize` 5ms →
`notifications/initialized` 202 3ms → `tools/list` 3ms (14 tools).
So the protocol logic itself is fine and fast; nothing in the code path
hangs on Node.

Deviations/suspects found while replaying:
1. `GET ${basePath}/api/mcp` (the Streamable-HTTP SSE probe every MCP client
   makes right after `notifications/initialized`) returns **404 JSON**, not
   the spec-mandated **405 + `Allow: POST`**. Clients special-case 405 as
   "server has no SSE stream, carry on"; a 404 is an error to them.
2. Production stores OAuth codes AND MCP tokens in **Workers KV**
   (`getAuthSecurityStore` → `createCloudflareKvAdapter`), which is
   eventually consistent and negatively caches misses for up to 60s. The
   browser half of the flow (`authorize`/`consent`, which WRITES the code)
   runs in the user's colo; the `token` exchange and every MCP call come
   from claude.ai's own backend in a different colo. A cross-colo read of a
   just-written key can legitimately miss → `invalid_grant` on `/token`, or
   a 401 on `/api/mcp` for a token that was just minted.

Next: `wrangler tail --format json` running while the user presses Connect,
to see the real status codes for `/oauth/token` and `/api/mcp`.

### Root cause found in `wrangler tail` (2026-08-14, second round)

Real claude.ai traffic (`user-agent: python-httpx/0.28.1`, `cf.colo: IAD`,
`asOrganization: Anthropic, PBC`) for one "Connect" press:

```
GET  /.well-known/oauth-authorization-server            200
POST /dry/api/mcp                                       401   (expected - triggers auth)
GET  /.well-known/oauth-protected-resource/dry/api/mcp  200
POST /dry/api/oauth/register                            201
<nothing else - /authorize is NEVER reached>
```

and every further Connect press re-runs `POST /register` (4 in a row seen),
which is claude.ai's UI spinning. So the flow now dies BETWEEN dynamic client
registration and the authorization redirect - the user-visible error is
claude.ai's "Authorization with the MCP server failed".

Two things changed on claude.ai's side since the first working run: it now
sends `mcp-protocol-version: 2025-11-25` (was 2025-06-18), and it now DOES
call `POST /register` (the earlier "no DCR support, always sends
client_id=Authorization" finding is obsolete).

Fixed/hardened in response (all deployed, version `63c2669b`):
- `routes/oauth.ts` `handleRegister` now returns a full RFC 7591 §3.2.1
  registration response (`client_id_issued_at`, `grant_types`,
  `response_types`, `token_endpoint_auth_method`, echoed `scope`/`client_uri`)
  instead of 4 fields. Anything omitted is defined to fall back to the RFC
  default, which is how a strict client concludes the registration is
  unusable - the prime suspect for the stall.
- **Refresh tokens implemented end to end** (`issueTokens` +
  `handleRefreshTokenGrant`): `/token` now returns a `refresh_token` and
  accepts `grant_type=refresh_token`, rotating it one-shot (OAuth 2.1 §4.3.1
  for public clients) and revoking the PAT the old refresh token was paired
  with. `oauth-metadata.ts` advertises `refresh_token` in
  `grant_types_supported`. claude.ai registers asking for that grant; before
  this it was neither advertised nor implemented.
- `routes/mcp.ts` bare `GET` now returns the spec-mandated `405 + Allow:
  POST` (was a 404 JSON body) - that GET is the Streamable HTTP client
  opening the server-push SSE stream, and 405 is the one status a client
  treats as "no stream here, carry on".
- `SUPPORTED_PROTOCOL_VERSIONS` gained `2025-11-25`.
- TEMPORARY diagnostic `console.log` of the `/register` request+response
  bodies (tail shows headers but never bodies). REMOVE once the connect
  succeeds.

Verified locally end to end after the change (real dev server, real login):
`authorize` 42ms → `consent` → `token` (now with `refresh_token`) →
`initialize` → `notifications/initialized` 202 → GET probe **405** →
`tools/list` 200 (14 tools) → `refresh_token` grant 200 → rotated access
token `tools/list` 200. 18/18 `oauth.test.ts` tests pass (2 new).

Still open / next suspect if it still stalls: Workers KV is eventually
consistent, and the authorization CODE is written in the user's colo
(browser, SIN) but read by `/token` from claude.ai's colo (IAD) a second
later - a cross-colo miss there returns `invalid_grant`. If the tail shows
`/token` 400, move the code (and only the code) to a strongly consistent
store (D1 via `kv/d1.ts`, binding `CONTENT_DB`).

### Round 3: the register fix worked, the failure moved to `/token`'s BODY

After deploying the RFC 7591 registration response, claude.ai's flow got
past registration for the first time - the user's `wrangler tail` shows the
complete sequence twice:

```
POST /dry/api/mcp 401 → both .well-known docs → POST /oauth/register
→ GET /oauth/authorize?...&resource=https://dev.drystack.dev/dry/api/mcp
→ /dry/oauth/consent (SPA) → /oauth/consent-info → POST /oauth/consent
→ POST /oauth/token   ← and then NOTHING; claude.ai errors out
```

The registration body it sends is now known (logged):
`{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"],
"token_endpoint_auth_method":"none","grant_types":["authorization_code",
"refresh_token"],"response_types":["code"],"client_name":"Claude",
"application_type":"web"}` - it does ask for the `refresh_token` grant.

`/token` did NOT fail: production KV holds 2 `oauth-refresh-tokens` records
(`wrangler kv key list --binding KV --remote --prefix drycms:kv:<ns>:`),
one per attempt, which only `issueTokens` writes - so the exchange returned
200 with a valid token and claude.ai rejected the RESPONSE itself. This also
kills the earlier KV-eventual-consistency theory: the code written in the
user's colo WAS readable from claude.ai's colo (IAD) seconds later.

The only conspicuous omission left in that response was `expires_in` (a
client that registered for the refresh grant needs a lifetime to schedule
against). Fixed:
- `createMcpToken` gained an optional `{ ttlMs }` - OAuth-issued access
  tokens now genuinely expire (24h; hand-made PATs are unchanged and stay
  revoke-only).
- `/token` returns `expires_in` alongside the rotating `refresh_token`, plus
  the RFC 6749 §5.1 `Cache-Control: no-store` / `Pragma: no-cache` headers.

Deployed as version `25707557`. 20/20 unit tests, typecheck clean.
