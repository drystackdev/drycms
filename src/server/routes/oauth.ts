/**
 * `status/mcp-oauth.md` - OAuth 2.1 Authorization Server for the MCP
 * endpoint (`routes/mcp.ts`), so claude.ai's web "custom connector" flow
 * (which requires OAuth discovery + `authorization_code` + PKCE) can connect
 * alongside the existing Bearer-PAT flow Claude Desktop/Code already use
 * (`McpConnect.tsx`). An OAuth-issued access token IS an ordinary MCP PAT -
 * minted via the same `createMcpToken()` `McpConnect.tsx`'s manual "Create
 * token" button already calls - so `mcp.ts`/`resolveMcpToken` need no
 * changes at all; this module is purely an alternative, consent-gated,
 * browser-driven way to mint one.
 *
 * The `.well-known/*` discovery documents live at the bare origin root
 * (`oauth-metadata.ts`, spec-mandated). Everything else - the endpoints
 * those documents point to - are ordinary routes here under
 * `${basePath}/api/oauth/*`, reusing `handler.ts`'s existing dispatch, CSRF
 * plumbing (see `csrf.ts`'s `oauth`-segment handling), and body limits.
 *
 * Security note (see the plan this was built from,
 * `/Users/kcoder/.claude/plans/wild-snuggling-brook.md`): `register` must
 * stay unauthenticated (real clients call it before any login exists), which
 * means an attacker can self-register a client and send a signed-in victim a
 * `.../oauth/consent?request_id=...` link for a flow the victim never
 * started - a confused-deputy attack ordinary CSRF doesn't catch, since the
 * victim's own browser legitimately submits it. The `drycms_oauth_req`
 * binding cookie set here at `/authorize` and checked at both
 * `consent-info`/`consent` closes that hole: a link opened in a browser that
 * never visited `/authorize` itself won't carry the matching cookie.
 */
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, unauthenticatedResponse, errorResponse } from "../route-helpers.js";
import { path as basePath } from "../config.js";
import { getAuthSecurityStore, createMcpToken, revokeMcpToken } from "../auth-security.js";
import { readCookie } from "../session.js";

const OAUTH_CLIENTS_NAMESPACE = "oauth-clients";
const OAUTH_AUTHZ_REQUESTS_NAMESPACE = "oauth-authz-requests";
const OAUTH_CODES_NAMESPACE = "oauth-codes";
const OAUTH_REFRESH_NAMESPACE = "oauth-refresh-tokens";
const OAUTH_REGISTER_RATE_NAMESPACE = "oauth-register-rate";
const OAUTH_REQ_COOKIE_NAME = "drycms_oauth_req";
const AUTHZ_REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
/** 24h rather than the more usual 1h: the refresh grant below rotates this
 * happily, but if a client's refresh ever misbehaves a day of working
 * connector beats an hour of one. */
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60_000;
const REGISTER_RATE_WINDOW_MS = 5 * 60_000;
const REGISTER_RATE_MAX = 20;

interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
}

interface OAuthAuthzRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  createdAt: string;
}

interface OAuthCodeRecord {
  userId: number;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}

/** What a `refresh_token` grant needs to mint the next access token: whose
 * account it belongs to, which client may present it, and the PAT it
 * replaces (revoked on rotation so a long-lived connector doesn't pile up
 * one dead token per refresh in the owner's MCP token list). */
interface OAuthRefreshRecord {
  userId: number;
  clientId: string;
  clientName: string;
  accessTokenId: string;
}

function clientKey(clientId: string): string {
  return `client-${clientId}`;
}

function authzRequestKey(requestId: string): string {
  return `req-${requestId}`;
}

function codeKey(codeHash: string): string {
  return `code-${codeHash}`;
}

function refreshKey(tokenHash: string): string {
  return `refresh-${tokenHash}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** PKCE's `S256` transform - base64url of the raw SHA-256 digest bytes
 * (RFC 7636 §4.2), not the hex string `sha256Hex` above produces. */
async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function appendQuery(url: string, params: Record<string, string>): string {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}

function oauthReqCookieHeader(context: DryRouteContext, requestId: string): string {
  return `${OAUTH_REQ_COOKIE_NAME}=${encodeURIComponent(requestId)}; Path=${basePath}; HttpOnly; SameSite=Lax; Max-Age=600${context.url.protocol === "https:" ? "; Secure" : ""}`;
}

function clearOauthReqCookieHeader(context: DryRouteContext): string {
  return `${OAUTH_REQ_COOKIE_NAME}=; Path=${basePath}; HttpOnly; SameSite=Lax; Max-Age=0${context.url.protocol === "https:" ? "; Secure" : ""}`;
}

function withSetCookie(response: Response, setCookie: string): Response {
  response.headers.append("Set-Cookie", setCookie);
  return response;
}

function clientIp(context: DryRouteContext): string {
  // Same header precedence `rate-limit.ts`'s `ipFrom` already uses.
  return context.request.headers.get("X-DryCMS-Client-IP")?.trim()
    || context.request.headers.get("CF-Connecting-IP")?.trim()
    || "unknown";
}

/** Light, non-atomic per-IP throttle for the unauthenticated `register`
 * endpoint - simpler than `rate-limit.ts`'s lock+atomic-increment machinery
 * (that exists to protect login against credential stuffing; a stray
 * double-counted DCR registration here is a non-issue), just enough to stop
 * `oauth-clients` from being trivially spammed. */
async function isRegisterRateLimited(context: DryRouteContext): Promise<boolean> {
  const store = getAuthSecurityStore(context.env);
  const key = `ip-${clientIp(context)}`;
  const now = Date.now();
  const existing = await store.get<{ count: number; windowStartedAt: number }>(OAUTH_REGISTER_RATE_NAMESPACE, key);
  const counter = !existing || now - existing.windowStartedAt >= REGISTER_RATE_WINDOW_MS
    ? { count: 1, windowStartedAt: now }
    : { ...existing, count: existing.count + 1 };
  await store.set(OAUTH_REGISTER_RATE_NAMESPACE, key, counter, { ttlMs: REGISTER_RATE_WINDOW_MS, durability: "sync" });
  return counter.count > REGISTER_RATE_MAX;
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") return true;
    // Loopback native/dev clients (RFC 8252) - no TLS available on localhost.
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

async function handleAuthorize(context: DryRouteContext): Promise<Response> {
  const params = context.url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";

  const store = getAuthSecurityStore(context.env);
  const registered = clientId ? await store.get<OAuthClientRecord>(OAUTH_CLIENTS_NAMESPACE, clientKey(clientId)) : null;

  let clientName: string;
  if (registered) {
    if (!registered.redirectUris.includes(redirectUri)) {
      // The redirect target itself isn't trusted for THIS client - can't
      // safely bounce the browser back to whatever `redirect_uri` claims.
      return jsonResponse({ error: "invalid_request", message: "redirect_uri doesn't match this client's registration." }, 400);
    }
    clientName = registered.clientName;
  } else {
    // Real-world interop gap (`status/mcp-oauth.md`): confirmed via
    // `wrangler tail` against production that claude.ai's MCP connector
    // fetches this server's discovery documents (including
    // `registration_endpoint`) but never calls `POST /register` - it always
    // sends a fixed, non-registered `client_id` (literally the string
    // `"Authorization"`) regardless. With no registry entry to check
    // `redirect_uri` against for a client that skipped DCR, fall back to
    // the same syntactic check `POST /register` itself enforces (https, or
    // loopback for native/dev clients) - PKCE below still protects the code
    // exchange, and the consent screen shows the real redirect host (not a
    // client-supplied name) so the user can still notice anything off
    // before approving.
    if (!clientId || !isAllowedRedirectUri(redirectUri)) {
      return jsonResponse({ error: "invalid_request", message: "Unknown client_id or invalid redirect_uri." }, 400);
    }
    clientName = safeHost(redirectUri);
  }

  const fail = (error: string, description: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: appendQuery(redirectUri, { error, error_description: description, state }) },
    });

  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only \"code\" is supported.");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }

  const requestId = crypto.randomUUID();
  await store.set(OAUTH_AUTHZ_REQUESTS_NAMESPACE, authzRequestKey(requestId), {
    clientId,
    clientName,
    redirectUri,
    codeChallenge,
    state,
    createdAt: new Date().toISOString(),
  } satisfies OAuthAuthzRequest, { ttlMs: AUTHZ_REQUEST_TTL_MS, durability: "sync" });

  const consentPath = `${basePath}/oauth/consent?request_id=${encodeURIComponent(requestId)}`;
  const location = context.session ? consentPath : `${basePath}/login?return_to=${encodeURIComponent(consentPath)}`;

  return withSetCookie(
    new Response(null, { status: 302, headers: { Location: location } }),
    oauthReqCookieHeader(context, requestId),
  );
}

async function handleRegister(context: DryRouteContext): Promise<Response> {
  if (await isRegisterRateLimited(context)) {
    return jsonResponse({ error: "rate_limited", message: "Too many registration attempts. Try again later." }, 429);
  }

  const raw = await context.request.text().catch(() => "");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const body = parsed as { redirect_uris?: unknown; client_name?: unknown; scope?: unknown; grant_types?: unknown; response_types?: unknown; client_uri?: unknown; token_endpoint_auth_method?: unknown };
  const rawUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const redirectUris = rawUris.filter((uri): uri is string => typeof uri === "string" && isAllowedRedirectUri(uri));
  if (redirectUris.length === 0) {
    console.log("[drycms] oauth/register rejected", raw.slice(0, 1000));
    return jsonResponse({ error: "invalid_redirect_uri", message: "At least one https:// (or loopback) redirect_uri is required." }, 400);
  }
  const clientName = (typeof body.client_name === "string" ? body.client_name.trim().slice(0, 200) : "") || "MCP client";

  const store = getAuthSecurityStore(context.env);
  const clientId = crypto.randomUUID();
  await store.set(OAUTH_CLIENTS_NAMESPACE, clientKey(clientId), {
    clientId,
    clientName,
    redirectUris,
    createdAt: new Date().toISOString(),
  } satisfies OAuthClientRecord, { durability: "sync" });

  // RFC 7591 §3.2.1: the response must echo back the client metadata the
  // server actually registered - a client that asked for something it
  // didn't get (a dropped `redirect_uri`, a grant type) has to be able to
  // see that. Anything not echoed is defined to fall back to the RFC's own
  // default, which is how a strict client decides the registration is
  // unusable and gives up (`status/mcp-oauth.md`'s claude.ai stall).
  const registration: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  if (typeof body.scope === "string" && body.scope.trim()) registration.scope = body.scope.trim().slice(0, 500);
  if (typeof body.client_uri === "string" && body.client_uri.trim()) registration.client_uri = body.client_uri.trim().slice(0, 500);
  // TEMPORARY (2026-08-14): claude.ai registers successfully and then never
  // calls `/authorize` - logging both sides of this exchange is the only way
  // to see what it actually asked for. Remove once that's diagnosed.
  console.log("[drycms] oauth/register request", raw.slice(0, 1000));
  console.log("[drycms] oauth/register response", JSON.stringify(registration));

  return jsonResponse(registration, 201);
}

async function handleConsentInfo(context: DryRouteContext): Promise<Response> {
  if (!context.session) return unauthenticatedResponse();
  const requestId = context.url.searchParams.get("request_id") ?? "";
  const cookieRequestId = readCookie(context.request, OAUTH_REQ_COOKIE_NAME);
  const expired = () => jsonResponse({ error: "invalid_request", message: "This connection request has expired. Please try connecting again." }, 400);
  if (!requestId || !cookieRequestId || requestId !== cookieRequestId) return expired();

  const store = getAuthSecurityStore(context.env);
  const record = await store.get<OAuthAuthzRequest>(OAUTH_AUTHZ_REQUESTS_NAMESPACE, authzRequestKey(requestId));
  if (!record) return expired();

  return jsonResponse({ clientName: record.clientName, redirectUriHost: safeHost(record.redirectUri) });
}

async function handleConsent(context: DryRouteContext): Promise<Response> {
  if (!context.session) return unauthenticatedResponse();
  const body = (await context.request.json().catch(() => ({}))) as { request_id?: unknown; approve?: unknown };
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const approve = body.approve === true;
  const clearCookie = clearOauthReqCookieHeader(context);
  const cookieRequestId = readCookie(context.request, OAUTH_REQ_COOKIE_NAME);

  const expired = () => withSetCookie(
    jsonResponse({ error: "invalid_request", message: "This connection request has expired or wasn't started in this browser. Please try connecting again." }, 400),
    clearCookie,
  );
  if (!requestId || !cookieRequestId || requestId !== cookieRequestId) return expired();

  const store = getAuthSecurityStore(context.env);
  // One-shot: a double-submitted Approve must not mint two codes off one
  // authorization decision.
  const record = await store.take<OAuthAuthzRequest>(OAUTH_AUTHZ_REQUESTS_NAMESPACE, authzRequestKey(requestId));
  if (!record) return expired();

  if (!approve) {
    return withSetCookie(
      jsonResponse({ redirect: appendQuery(record.redirectUri, { error: "access_denied", state: record.state }) }),
      clearCookie,
    );
  }

  const code = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  await store.set(OAUTH_CODES_NAMESPACE, codeKey(await sha256Hex(code)), {
    userId: context.session.id,
    clientId: record.clientId,
    redirectUri: record.redirectUri,
    codeChallenge: record.codeChallenge,
  } satisfies OAuthCodeRecord, { ttlMs: CODE_TTL_MS, durability: "sync" });

  return withSetCookie(
    jsonResponse({ redirect: appendQuery(record.redirectUri, { code, state: record.state }) }),
    clearCookie,
  );
}

async function readTokenRequestBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value ?? "")]));
  }
  // Spec-mandated `application/x-www-form-urlencoded` - `formData()` parses it.
  const form = await request.formData().catch(() => null);
  return form ? Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])) : {};
}

/**
 * Mints the access token (an ordinary MCP PAT - see this file's own doc
 * comment, now with a real expiry) plus the rotating refresh token that goes
 * with it.
 *
 * `expires_in` is not optional in practice: claude.ai's connector accepted a
 * 200 from this endpoint and still reported "Authorization with DryCMS
 * failed" while the response carried only `access_token`/`token_type`/
 * `refresh_token` (proven by production KV holding the refresh records the
 * exchange wrote - `status/mcp-oauth.md`). A client that registered asking
 * for the `refresh_token` grant expects a lifetime it can schedule against,
 * so the token now genuinely expires and says so.
 */
async function issueTokens(
  context: DryRouteContext,
  grant: { userId: number; clientId: string; clientName: string },
): Promise<Response> {
  const store = getAuthSecurityStore(context.env);
  const { tokenId, token } = await createMcpToken(grant.userId, grant.clientName, context.env, { ttlMs: ACCESS_TOKEN_TTL_MS });
  const refreshToken = `mcpr_${crypto.randomUUID()}${crypto.randomUUID()}`;
  await store.set(OAUTH_REFRESH_NAMESPACE, refreshKey(await sha256Hex(refreshToken)), {
    userId: grant.userId,
    clientId: grant.clientId,
    clientName: grant.clientName,
    accessTokenId: tokenId,
  } satisfies OAuthRefreshRecord, { durability: "sync" });

  // Deliberately no `scope` in the response: a client that requested none
  // (this server advertises no `scopes_supported`) is entitled to reject a
  // token response that grants a scope it never asked for.
  const response = jsonResponse({
    access_token: token,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
  });
  // RFC 6749 §5.1 - a token response MUST NOT be cached anywhere.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}

async function handleAuthorizationCodeGrant(context: DryRouteContext, body: Record<string, string>): Promise<Response> {
  const { code = "", redirect_uri: redirectUri = "", client_id: clientId = "", code_verifier: codeVerifier = "" } = body;
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const store = getAuthSecurityStore(context.env);
  // One-shot: a replayed code must never mint a second token.
  const record = await store.take<OAuthCodeRecord>(OAUTH_CODES_NAMESPACE, codeKey(await sha256Hex(code)));
  if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri) {
    return jsonResponse({ error: "invalid_grant" }, 400);
  }
  const computedChallenge = await sha256Base64Url(codeVerifier);
  if (computedChallenge !== record.codeChallenge) {
    return jsonResponse({ error: "invalid_grant" }, 400);
  }

  const client = await store.get<OAuthClientRecord>(OAUTH_CLIENTS_NAMESPACE, clientKey(clientId));
  return issueTokens(context, { userId: record.userId, clientId, clientName: client?.clientName || "MCP client" });
}

/** OAuth 2.1 §4.3.1 requires refresh tokens issued to a public client to be
 * rotated, so this is one-shot too (`take`, not `get`) and the PAT the old
 * refresh token was paired with is revoked as the new one is issued. */
async function handleRefreshTokenGrant(context: DryRouteContext, body: Record<string, string>): Promise<Response> {
  const { refresh_token: refreshToken = "", client_id: clientId = "" } = body;
  if (!refreshToken) return jsonResponse({ error: "invalid_request" }, 400);

  const store = getAuthSecurityStore(context.env);
  const record = await store.take<OAuthRefreshRecord>(OAUTH_REFRESH_NAMESPACE, refreshKey(await sha256Hex(refreshToken)));
  if (!record || (clientId && record.clientId !== clientId)) {
    return jsonResponse({ error: "invalid_grant" }, 400);
  }

  await revokeMcpToken(record.userId, record.accessTokenId, context.env);
  return issueTokens(context, { userId: record.userId, clientId: record.clientId, clientName: record.clientName });
}

async function handleToken(context: DryRouteContext): Promise<Response> {
  const body = await readTokenRequestBody(context.request);
  if (body.grant_type === "authorization_code") return handleAuthorizationCodeGrant(context, body);
  if (body.grant_type === "refresh_token") return handleRefreshTokenGrant(context, body);
  return jsonResponse({ error: "unsupported_grant_type" }, 400);
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const slug = context.params.slug;
    if (slug === "authorize") return await handleAuthorize(context);
    if (slug === "consent-info") return await handleConsentInfo(context);
    return jsonResponse({ error: "not_found", message: `Unknown oauth endpoint "${String(slug)}".` }, 404);
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: DryRouteHandler = async (context) => {
  try {
    const slug = context.params.slug;
    if (slug === "register") return await handleRegister(context);
    if (slug === "token") return await handleToken(context);
    if (slug === "consent") return await handleConsent(context);
    return jsonResponse({ error: "not_found", message: `Unknown oauth endpoint "${String(slug)}".` }, 404);
  } catch (error) {
    return errorResponse(error);
  }
};
