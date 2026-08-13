import type { DryRouteContext } from "../context.js";
import { describe, expect, it, vi } from "vitest";

// Same lightweight pattern `auth-security.test.ts` uses: no `kv` field means
// `auth-security.ts`'s `storeFor` falls back to its in-memory `fallbackAdapter`
// - no filesystem/DB setup needed for these tests at all.
vi.mock("../config.js", () => ({ path: "/dry" }));

const { GET, POST } = await import("./oauth.js");
const { resolveMcpToken } = await import("../auth-security.js");

const SESSION = { id: 4001, name: "Test User", email: "test@example.com" };

function makeContext(opts: {
  method: string;
  slug: string;
  search?: string;
  body?: unknown;
  cookie?: string;
  session?: typeof SESSION | null;
}): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/oauth/${opts.slug}${opts.search ?? ""}`);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.Cookie = opts.cookie;
  const request = new Request(url, {
    method: opts.method,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    headers,
  });
  return { params: { slug: opts.slug }, request, url, env: {}, session: opts.session ?? null };
}

function cookieFrom(response: Response): string | undefined {
  const setCookie = response.headers.get("Set-Cookie");
  return setCookie ? setCookie.split(";")[0] : undefined;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function registerClient(redirectUri: string, clientName = "Claude") {
  const response = await POST(makeContext({
    method: "POST",
    slug: "register",
    body: { redirect_uris: [redirectUri], client_name: clientName },
  }));
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string; client_name: string; redirect_uris: string[] };
}

/** Runs `/authorize` -> `/consent` (approve) end to end for an already-signed-
 * in session, returning the issued `code`/`state` plus the PKCE verifier the
 * `/token` exchange needs. */
async function authorizeAndApprove(clientId: string, redirectUri: string) {
  const codeVerifier = "test-code-verifier-with-enough-entropy-1234567890";
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const authorizeResponse = await GET(makeContext({
    method: "GET",
    slug: "authorize",
    search: `?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=xyz`,
    session: SESSION,
  }));
  expect(authorizeResponse.status).toBe(302);
  const reqCookie = cookieFrom(authorizeResponse)!;
  const location = authorizeResponse.headers.get("Location")!;
  expect(location).toBe(`/dry/oauth/consent?request_id=${new URL(location, "http://localhost").searchParams.get("request_id")}`);
  const requestId = new URL(location, "http://localhost").searchParams.get("request_id")!;

  const consentResponse = await POST(makeContext({
    method: "POST",
    slug: "consent",
    body: { request_id: requestId, approve: true },
    cookie: reqCookie,
    session: SESSION,
  }));
  expect(consentResponse.status).toBe(200);
  const { redirect } = (await consentResponse.json()) as { redirect: string };
  const redirectUrl = new URL(redirect);
  expect(redirectUrl.searchParams.get("state")).toBe("xyz");
  const code = redirectUrl.searchParams.get("code")!;
  expect(code).toBeTruthy();

  return { code, codeVerifier, requestId, reqCookie };
}

describe("oauth register", () => {
  it("registers a public client and rejects a non-https redirect_uri", async () => {
    const client = await registerClient("https://claude.ai/api/mcp/auth_callback", "Claude");
    expect(client.client_id).toBeTruthy();
    expect(client.redirect_uris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);

    const rejected = await POST(makeContext({
      method: "POST",
      slug: "register",
      body: { redirect_uris: ["http://evil.example/callback"] },
    }));
    expect(rejected.status).toBe(400);
  });

  it("caps client_name length instead of rejecting", async () => {
    const client = await registerClient("https://claude.ai/callback", "x".repeat(500));
    expect(client.client_name.length).toBeLessThanOrEqual(200);
  });
});

describe("oauth authorize", () => {
  it("rejects an unknown client_id/redirect_uri with a plain 400 (no redirect)", async () => {
    const response = await GET(makeContext({
      method: "GET",
      slug: "authorize",
      search: "?response_type=code&client_id=nope&redirect_uri=https%3A%2F%2Fevil.example&code_challenge=abc&code_challenge_method=S256",
    }));
    expect(response.status).toBe(400);
  });

  it("sends an anonymous visitor to login with a return_to back to the consent page", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const response = await GET(makeContext({
      method: "GET",
      slug: "authorize",
      search: `?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/callback")}&code_challenge=abc&code_challenge_method=S256&state=s1`,
      session: null,
    }));
    expect(response.status).toBe(302);
    const location = response.headers.get("Location")!;
    expect(location.startsWith("/dry/login?return_to=")).toBe(true);
    expect(decodeURIComponent(location.slice("/dry/login?return_to=".length))).toMatch(/^\/dry\/oauth\/consent\?request_id=/);
    expect(cookieFrom(response)).toMatch(/^drycms_oauth_req=/);
  });

  it("sends a signed-in visitor straight to consent", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const response = await GET(makeContext({
      method: "GET",
      slug: "authorize",
      search: `?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/callback")}&code_challenge=abc&code_challenge_method=S256`,
      session: SESSION,
    }));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/dry\/oauth\/consent\?request_id=/);
  });

  it("redirects back to the client with an error for a bad response_type or missing PKCE", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const badType = await GET(makeContext({
      method: "GET",
      slug: "authorize",
      search: `?response_type=token&client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/callback")}&code_challenge=abc&code_challenge_method=S256&state=s1`,
      session: SESSION,
    }));
    expect(badType.status).toBe(302);
    expect(new URL(badType.headers.get("Location")!).searchParams.get("error")).toBe("unsupported_response_type");

    const noPkce = await GET(makeContext({
      method: "GET",
      slug: "authorize",
      search: `?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/callback")}&state=s1`,
      session: SESSION,
    }));
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get("Location")!).searchParams.get("error")).toBe("invalid_request");
  });
});

describe("oauth consent-info / consent", () => {
  it("requires a session", async () => {
    const response = await GET(makeContext({ method: "GET", slug: "consent-info", search: "?request_id=x" }));
    expect(response.status).toBe(401);
  });

  it("rejects a request_id that doesn't match the binding cookie (confused-deputy guard)", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const authorizeResponse = await GET(makeContext({
      method: "GET",
      slug: "authorize",
      search: `?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/callback")}&code_challenge=abc&code_challenge_method=S256`,
      session: SESSION,
    }));
    const requestId = new URL(authorizeResponse.headers.get("Location")!, "http://localhost").searchParams.get("request_id")!;

    // A victim opening the link in a browser that never visited /authorize
    // itself carries no (or a mismatched) `drycms_oauth_req` cookie.
    const noCookie = await GET(makeContext({ method: "GET", slug: "consent-info", search: `?request_id=${requestId}`, session: SESSION }));
    expect(noCookie.status).toBe(400);

    const wrongCookie = await GET(makeContext({
      method: "GET",
      slug: "consent-info",
      search: `?request_id=${requestId}`,
      cookie: "drycms_oauth_req=something-else",
      session: SESSION,
    }));
    expect(wrongCookie.status).toBe(400);
  });

  it("returns client info once the cookie matches, and denies cleanly", async () => {
    const client = await registerClient("https://claude.ai/callback", "Claude");
    const authorizeResponse = await GET(makeContext({
      method: "GET",
      slug: "authorize",
      search: `?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/callback")}&code_challenge=abc&code_challenge_method=S256&state=deny-me`,
      session: SESSION,
    }));
    const reqCookie = cookieFrom(authorizeResponse)!;
    const requestId = new URL(authorizeResponse.headers.get("Location")!, "http://localhost").searchParams.get("request_id")!;

    const info = await GET(makeContext({ method: "GET", slug: "consent-info", search: `?request_id=${requestId}`, cookie: reqCookie, session: SESSION }));
    expect(info.status).toBe(200);
    expect(await info.json()).toEqual({ clientName: "Claude", redirectUriHost: "claude.ai" });

    const denied = await POST(makeContext({ method: "POST", slug: "consent", body: { request_id: requestId, approve: false }, cookie: reqCookie, session: SESSION }));
    expect(denied.status).toBe(200);
    const { redirect } = (await denied.json()) as { redirect: string };
    const url = new URL(redirect);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("deny-me");
  });

  it("a double-submitted approve only mints one code (request is one-shot)", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const { requestId, reqCookie } = await authorizeAndApprove(client.client_id, "https://claude.ai/callback");
    const replay = await POST(makeContext({ method: "POST", slug: "consent", body: { request_id: requestId, approve: true }, cookie: reqCookie, session: SESSION }));
    expect(replay.status).toBe(400);
  });
});

describe("oauth token", () => {
  it("exchanges a valid code + verifier for an access token that resolves back to the approving user", async () => {
    const client = await registerClient("https://claude.ai/callback", "Claude");
    const { code, codeVerifier } = await authorizeAndApprove(client.client_id, "https://claude.ai/callback");

    const tokenResponse = await POST(makeContext({
      method: "POST",
      slug: "token",
      body: { grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/callback", client_id: client.client_id, code_verifier: codeVerifier },
    }));
    expect(tokenResponse.status).toBe(200);
    const { access_token, token_type } = (await tokenResponse.json()) as { access_token: string; token_type: string };
    expect(token_type).toBe("Bearer");
    expect(await resolveMcpToken(access_token, {})).toEqual({ userId: SESSION.id });
  });

  it("rejects a replayed code", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const { code, codeVerifier } = await authorizeAndApprove(client.client_id, "https://claude.ai/callback");
    const grant = { grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/callback", client_id: client.client_id, code_verifier: codeVerifier };

    const first = await POST(makeContext({ method: "POST", slug: "token", body: grant }));
    expect(first.status).toBe(200);
    const second = await POST(makeContext({ method: "POST", slug: "token", body: grant }));
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a mismatched code_verifier", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const { code } = await authorizeAndApprove(client.client_id, "https://claude.ai/callback");
    const response = await POST(makeContext({
      method: "POST",
      slug: "token",
      body: { grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/callback", client_id: client.client_id, code_verifier: "wrong-verifier" },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a mismatched client_id or redirect_uri", async () => {
    const client = await registerClient("https://claude.ai/callback");
    const other = await registerClient("https://other.example/callback", "Other");
    const { code, codeVerifier } = await authorizeAndApprove(client.client_id, "https://claude.ai/callback");
    const response = await POST(makeContext({
      method: "POST",
      slug: "token",
      body: { grant_type: "authorization_code", code, redirect_uri: "https://claude.ai/callback", client_id: other.client_id, code_verifier: codeVerifier },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("rejects an unsupported grant_type", async () => {
    const response = await POST(makeContext({ method: "POST", slug: "token", body: { grant_type: "refresh_token" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "unsupported_grant_type" });
  });
});
