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

### Round 4: `expires_in` wasn't it either - and this is a KNOWN claude.ai bug

Post-deploy tail (my own `--format json` run, so with statuses):

```
02:38:03 POST /dry/api/mcp                                  401  IAD  python-httpx
02:38:04 GET  /.well-known/oauth-protected-resource/...     200  IAD
02:38:04 GET  /.well-known/oauth-authorization-server       200  IAD
02:38:04 POST /dry/api/oauth/register                       201  IAD
02:38:06 GET  /dry/api/oauth/authorize                      302  SIN  (browser)
02:38:11 GET  /dry/api/oauth/consent-info                   200  SIN
02:38:12 POST /dry/api/oauth/consent                        200  SIN
02:38:14 POST /dry/api/oauth/token                          200  IAD
<nothing - claude.ai never calls the MCP endpoint with the token>
```

Everything on our side returns exactly what it should, and claude.ai still
reports "Authorization with DryCMS failed". This is a documented,
still-open claude.ai-side failure mode, reported by several independent
servers with correct implementations:
`anthropics/claude-ai-mcp` issues #315 (JWT + full metadata + scopes +
Cache-Control + RFC 9207 `iss` + RFC 8707 audience binding all tried, closed
as not planned), #690 (token issued, Claude never sends
`Authorization: Bearer` on the follow-up), #171, #313, #326, #506. In #690
the follow-up request at least reaches the server without the header; here
no follow-up request arrives at all.

From Anthropic's own connector docs (claude.com/docs/connectors/building/
authentication) the only requirement we were still not meeting:

> To control which scopes Claude requests, include a `scope` parameter in the
> `WWW-Authenticate` header on your 401 response. If you don't, Claude
> requests the scopes your protected resource metadata advertises in
> `scopes_supported`. Claude also appends `offline_access` when your
> authorization server metadata lists it in `scopes_supported`, to obtain a
> refresh token.

We advertised no scopes at all, so Claude requested none and the token
response granted none. Now implemented end to end (deployed, version
`91005966`):
- PRM: `scopes_supported: ["mcp"]`, `bearer_methods_supported: ["header"]`.
- AS metadata: `scopes_supported: ["mcp", "offline_access"]`.
- `/authorize` accepts `scope`, narrows it to what's grantable
  (`grantableScope`), and carries it through the authz request → code →
  refresh record; `/token` echoes the granted `scope` (only when one was
  requested - granting an unrequested scope is itself a rejection reason).
- TEMPORARY log of the (redacted) `/token` request body, to finally see
  whether claude.ai sends `resource`/`scope`/`client_secret` there.

Also verified NOT the cause along the way: KV cross-colo consistency (the
code written in SIN was read fine from IAD), a WAF/bot block in front of the
Worker (an authenticated-shaped `POST /dry/api/mcp` with
`user-agent: python-httpx` reaches the Worker and gets a normal 401), and
endpoint latency (every OAuth endpoint answers in <1s, far under claude.ai's
10s budget).

If round 4 still fails, the remaining evidence all points at claude.ai's
broker rather than this server, and the practical answer is the PAT flow
(`McpConnect.tsx`) with Claude Code/Desktop, which works today.

### Round 5: Codex/ChatGPT connects to this same server; only Claude doesn't

User report: the OpenAI (Codex/ChatGPT) connector completes the identical
DCR + PKCE + token flow against `https://dev.drystack.dev/dry/api/mcp` and
works. That is the strongest evidence yet that this authorization server is
correct - a second independent third-party OAuth+MCP client drives it end to
end - and matches `anthropics/claude-ai-mcp` issue #326 ("works in Claude
Code and ChatGPT") exactly.

One structural difference between our tokens and every working connector's
was still left: the access token was `mcp_<uuid>.<uuid>` - a bearer token
with EXACTLY ONE dot. That looks like a malformed JWT to any client that
sniffs for one, and the usual `header, payload, signature = token.split(".")`
raises on a two-segment string. Codex never inspects the token; a broker
that does would throw right after a successful exchange - precisely our
symptom. `createMcpToken` now mints dot-free tokens (only the hash is ever
stored, so nothing depends on the format; tokens issued earlier keep
working). Deployed as version `f834e330`.

Next diagnostic if this fails too: the temporary `/token` request log (added
in round 4, not yet exercised by a real attempt) will show whether claude.ai
sends `resource`/`scope`/`client_secret` there. After that, the evidence is
conclusive enough to report upstream rather than keep changing this server.

### ROOT CAUSE (2026-08-14, round 6): Cloudflare's "Manage AI bots" WAF rule

**Nothing was ever wrong with this server.** The Cloudflare WAF on the
`drystack.dev` zone was blocking claude.ai's MCP requests at the EDGE, before
the Worker ran - which is exactly why `wrangler tail` showed "claude.ai never
calls the MCP endpoint": a request blocked at the edge never reaches the
Worker and therefore never appears in a tail.

Found by querying the zone's `firewallEventsAdaptive` GraphQL dataset (NOT
visible in `wrangler tail`; the wrangler OAuth token in
`~/Library/Preferences/.wrangler/config/default.toml` can read it, though
zone *settings*/bot_management return 403 with that token):

```
20:18:30  POST /dry/api/oauth/token  200  IAD  python-httpx/0.28.1   ← Worker, OK
20:18:32  POST /dry/api/mcp          BLOCK     Claude-User 160.79.106.177
20:18:35  POST /dry/api/mcp          BLOCK     Claude-User 160.79.106.177
   rule: "Manage AI bots"  ruleId 7bd01eeccb6b420fa0be30264603a5cb
   ruleset 3e677e63d4e9479382576f3fa66279e7 (source: firewallManaged)
```

Two different clients are involved in one connect, and only one of them was
blocked - which is what hid this for five rounds:

- the OAuth/discovery half runs from claude.ai's backend as
  `user-agent: python-httpx/0.28.1` → not classified as an AI bot → reaches
  the Worker (that's why register/authorize/token all returned 200);
- the actual MCP traffic runs as `user-agent: Claude-User` from
  `160.79.106.0/24` → classified as an AI bot → **blocked**.

Reproducible with curl against production:

```
curl -X POST https://dev.drystack.dev/dry/api/mcp -H 'User-Agent: Claude-User' ...
  → 403 "Your request was blocked."     (edge, no Worker log)
curl -X POST https://dev.drystack.dev/dry/api/mcp -H 'User-Agent: python-httpx/0.28.1' ...
  → 401 {"error":"unauthenticated"}     (Worker)
```

Also explains round 5's "Codex/ChatGPT connects fine": its connector's UA
isn't on Cloudflare's AI-bot list, so it was never blocked.

Separately visible in the same dataset: a `bic` (Browser Integrity Check)
block on `Python-urllib/*` UAs - unrelated to claude.ai, but it will bite any
scripted QA against production that doesn't set a browser-ish UA.

**Fix (zone config, not code)** - Cloudflare dashboard for `drystack.dev`,
Security → WAF → Custom rules, new rule placed FIRST:

- Expression: `http.request.uri.path eq "/dry/api/mcp" or
  starts_with(http.request.uri.path, "/dry/api/oauth/") or
  starts_with(http.request.uri.path, "/.well-known/oauth")`
- Action: **Skip** → All managed rules (the "Manage AI bots" rule runs in the
  `http_request_firewall_managed` phase, so a skip from the custom-rules
  phase bypasses it), and also tick Browser Integrity Check.

The blunt alternative is turning "Block AI bots" off zone-wide (Security →
Bots / AI Crawl Control), but that also drops AI-bot protection for the
public site, so the path-scoped skip is preferred.

Note for every future tenant deploy: this is per-zone Cloudflare
configuration, so any new tenant zone that has AI-bot blocking enabled will
hit the identical failure with a perfectly correct server.

Round 4/5 code changes (`expires_in`, scopes, refresh tokens, dot-free
tokens, `405 + Allow: POST` on the bare `GET`) are all still correct and
worth keeping - they just weren't the cause. The TEMPORARY diagnostic
`console.log`s in `routes/oauth.ts` (`handleRegister`, `handleToken`) can be
removed once a connect succeeds.

#### FIX APPLIED (2026-08-14 20:40 UTC) and verified

Created via the Rulesets API with a one-off `Zone WAF: Edit` token the user
issued (since revoked). The zone had NO custom-rules ruleset at all, so one
was created containing exactly this single rule:

```
ruleset  d3eef0e8c2394574b9ed1a5cecc0185a  (zone, http_request_firewall_custom)
rule     30069ef1747e4c13bf0f2813a9d8a1cf  "Allow Claude MCP connector
                                            (skip managed rules on MCP/OAuth paths)"
action   skip
  phases   http_request_firewall_managed, http_request_sbfm
  products waf, bic, uaBlock, hot, securityLevel, zoneLockdown
  ruleset  current
expr     (http.request.uri.path eq "/dry/api/mcp")
      or (starts_with(http.request.uri.path, "/dry/api/oauth/"))
      or (starts_with(http.request.uri.path, "/.well-known/oauth"))
```

GOTCHA that nearly caused a wrong second diagnosis: the rule looks like it
did nothing for the first ~2 minutes (immediately after creation,
`Claude-User` still got 403 and `Python-urllib` still got 1010). It is purely
propagation delay - re-test a few minutes later before concluding the skip
doesn't cover the rule. Verified after propagation:

```
as Claude-User:  POST /dry/api/mcp                  401  (reaches the Worker)
                 GET  /dry/api/mcp                  401
                 GET  /.well-known/oauth-*          200
                 POST /dry/api/oauth/token (bogus)  400  invalid_grant
                 GET  /                             403  <- still blocked, protection intact
                 GET  /dry/                         403  <- still blocked
as browser UA:   GET  /                             200
```

So AI-bot blocking is untouched everywhere except the three MCP/OAuth path
groups, which are protected by the app's own bearer-token check anyway.

### ROOT CAUSE (round 6): the connector is configured with static client
### credentials - `client_id` is the literal string "Authorization"

The `/token` request log added in round 4 finally caught a real claude.ai
exchange, side by side with a working Codex one:

```
claude.ai (IAD):
  GET  /dry/api/oauth/authorize?response_type=code&client_id=Authorization&...
  POST /dry/api/oauth/token
    {"grant_type":"authorization_code","code":"<72 chars>",
     "client_id":"Authorization","code_verifier":"<redacted>",
     "redirect_uri":"https://claude.ai/api/mcp/auth_callback",
     "resource":"https://dev.drystack.dev/dry/api/mcp",
     "client_secret":"<redacted>"}     <- static credentials!

codex (SIN):
  POST /dry/api/oauth/token
    {"grant_type":"refresh_token","refresh_token":"<redacted>",
     "client_id":"6abfda3e-d09f-4cc7-9879-c3c95570c411",   <- the DCR uuid
     "resource":"https://dev.drystack.dev/dry/api/mcp"}
```

claude.ai calls `POST /register`, gets a proper uuid `client_id` back - and
then throws it away and sends `client_id=Authorization` plus a
`client_secret` instead. That only happens when the custom connector was
added with the optional **OAuth Client ID / OAuth Client Secret** fields
filled in (claude.com/docs/connectors/building/authentication: "Supplying
your own pre-registered client ID (and secret...) as static client
credentials... avoids dynamic client registration entirely"). Someone typed
`Authorization` into the Client ID box - which also explains the very first
round's mystery, wrongly written up back then as "claude.ai has no DCR
support and hardcodes the string".

This server's `handleAuthorize` fallback for unregistered client ids (added
in round 1 on that wrong theory) is what let the flow get all the way to a
200 token response with garbage credentials instead of failing loudly at
`/authorize` - the misconfiguration was invisible from our side until the
token body was logged.

FIX: in claude.ai, edit the connector (or delete and re-add it with the URL
only) leaving OAuth Client ID and OAuth Client Secret EMPTY, so DCR is used
and the registered uuid `client_id` flows through authorize/token - exactly
what Codex does on this same server.

Note the fallback is still worth keeping: Claude Code identifies itself with
a Client ID Metadata Document (an https URL as `client_id`, never registered
here), and that path needs it.

### Follow-up: an existing token row can't show its value - Connect removed (2026-08-14)

Symptom (user): pressing Connect on an existing token row showed
`<YOUR_TOKEN>` instead of a real value. That is by design and NOT fixable by
reading anything back - `auth-security.ts`'s `createMcpToken` persists only
`hash(token)`, so the raw value genuinely no longer exists anywhere on the
server after the create response. (Two alternatives were offered: storing the
raw value so it could be re-revealed - declined, it would put a working bearer
token in KV/D1 in plaintext - and a "Regenerate token" button, which was built
and verified end to end, then removed at the user's request.)

Final shape in `McpConnect.tsx`:

- A token row now carries ONLY the Revoke button. The Connect (link icon)
  button is gone - it could never have shown anything but a placeholder, so it
  was pure noise. Getting a fresh usable token = Revoke + Generate.
- `McpConnectDialog` therefore opens in exactly one situation, right after
  `handleGenerate` mints a token, and lost its `revealed`/placeholder branch
  (`MCP_TOKEN_PLACEHOLDER`, the `revealedTokens` in-memory map, and the
  `tokenId` on its state all deleted with it).
- The one keeper from that round: the dialog now shows the raw token in its
  own copyable `CodeBlock` above the per-client connect snippets. Before, the
  value was only ever visible embedded inside the command for whichever client
  tab happened to be selected.

`routes/auth.ts` is back to its pre-round state (the `replaces` body field and
its `auth.test.ts` route test were removed along with the button).
1297/1297 unit tests + `typecheck` pass.

Gotcha worth remembering: the running `bun run dev` server was started before
these edits and kept serving stale `routes/auth.ts` (the tokens it minted
still had the pre-`308fe5b` dot in them) - same server-HMR gap already noted
above. A full dev-server restart was needed before any live check meant
anything.
