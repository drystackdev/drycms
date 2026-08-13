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
import { getAuthSecurityStore, createMcpToken } from "../auth-security.js";
import { readCookie } from "../session.js";

const OAUTH_CLIENTS_NAMESPACE = "oauth-clients";
const OAUTH_AUTHZ_REQUESTS_NAMESPACE = "oauth-authz-requests";
const OAUTH_CODES_NAMESPACE = "oauth-codes";
const OAUTH_REGISTER_RATE_NAMESPACE = "oauth-register-rate";
const OAUTH_REQ_COOKIE_NAME = "drycms_oauth_req";
const AUTHZ_REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
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

function clientKey(clientId: string): string {
  return `client-${clientId}`;
}

function authzRequestKey(requestId: string): string {
  return `req-${requestId}`;
}

function codeKey(codeHash: string): string {
  return `code-${codeHash}`;
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

async function handleAuthorize(context: DryRouteContext): Promise<Response> {
  const params = context.url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";

  const store = getAuthSecurityStore(context.env);
  const client = clientId ? await store.get<OAuthClientRecord>(OAUTH_CLIENTS_NAMESPACE, clientKey(clientId)) : null;
  if (!client || !client.redirectUris.includes(redirectUri)) {
    // The redirect target itself isn't trusted - can't safely bounce the
    // browser back to whatever `redirect_uri` claims to be.
    return jsonResponse({ error: "invalid_request", message: "Unknown client_id or unregistered redirect_uri." }, 400);
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
    clientName: client.clientName,
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

  const body = (await context.request.json().catch(() => ({}))) as { redirect_uris?: unknown; client_name?: unknown };
  const rawUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const redirectUris = rawUris.filter((uri): uri is string => typeof uri === "string" && isAllowedRedirectUri(uri));
  if (redirectUris.length === 0) {
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

  return jsonResponse({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
  }, 201);
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

  let redirectUriHost = record.redirectUri;
  try {
    redirectUriHost = new URL(record.redirectUri).host;
  } catch {
    // Keep the raw value - already validated at registration time regardless.
  }
  return jsonResponse({ clientName: record.clientName, redirectUriHost });
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

async function handleToken(context: DryRouteContext): Promise<Response> {
  const body = await readTokenRequestBody(context.request);
  if (body.grant_type !== "authorization_code") {
    return jsonResponse({ error: "unsupported_grant_type" }, 400);
  }
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
  // v1 scope cut: long-lived, revoke-only token - same trust model every
  // other MCP PAT already has (see this file's own doc comment). No
  // `expires_in`/refresh_token grant.
  const { token } = await createMcpToken(record.userId, client?.clientName || "MCP client", context.env);
  return jsonResponse({ access_token: token, token_type: "Bearer" });
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
