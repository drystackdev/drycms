import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));
const ORIGINAL_SECRET = process.env.DRYCMS_SECRET_KEY;
const ORIGINAL_BOOTSTRAP = process.env.DRYCMS_BOOTSTRAP_TOKEN;

// Mirrors `routes/auth.test.ts`'s own scaffold - a real content engine
// backed by a throwaway temp dir, needed because `handleVeiRoute`'s refresh
// fallback (below) round-trips through the real `POST /api/auth/refresh`
// route, which reads the "user" collection.
vi.mock("./config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("./options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-vei-routes-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  // Mirrors every export the real `config.ts` derives from `resolved` -
  // `handler.ts` (routed through by `handleVeiRoute`'s refresh fallback)
  // touches several of these (`kv` in particular), not just `path`/`content`.
  return {
    ...resolved,
    resolved,
    componentsStorage: resolved.components.storage,
    pagesCacheStorage: resolved.pagesCache.storage,
    typesCacheStorage: resolved.typesCache.storage,
  };
});

const { path: adminPath } = await import("./config.js");
const { handleVeiRoute } = await import("./vei-routes.js");
const { VEI_COOKIE_NAME } = await import("./vei-session.js");
const { POST: authPost } = await import("./routes/auth.js");
const { SESSION_COOKIE_NAME } = await import("./session.js");
const { CSRF_COOKIE_NAME } = await import("./csrf.js");
const { getContentAdapters } = await import("./content-adapters.js");

beforeEach(() => {
  process.env.DRYCMS_SECRET_KEY = "test-passphrase-do-not-use-in-prod";
  process.env.DRYCMS_BOOTSTRAP_TOKEN = "test-bootstrap-token-do-not-use-in-prod-1234567890";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.DRYCMS_SECRET_KEY;
  else process.env.DRYCMS_SECRET_KEY = ORIGINAL_SECRET;
  if (ORIGINAL_BOOTSTRAP === undefined) delete process.env.DRYCMS_BOOTSTRAP_TOKEN;
  else process.env.DRYCMS_BOOTSTRAP_TOKEN = ORIGINAL_BOOTSTRAP;
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

const ENTER = `http://localhost${adminPath}/vei/enter`;
const EXIT = `http://localhost${adminPath}/vei/exit`;

/** Every cookie pair (`name=value`, no attributes) set across ALL of a
 * response's `Set-Cookie` headers - a real browser stores each separately,
 * this reassembles them into one `Cookie` header for the next request the
 * same way. */
function cookiesFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return (headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

/** Registers the one Super Admin account these tests share, or - since the
 * same temp-dir content engine persists across every test in this file -
 * logs in with the same credentials once a prior test already created it. */
async function adminSessionCookie(): Promise<string> {
  const registerUrl = new URL(`http://localhost${adminPath}/api/auth/register-first-admin`);
  const registerResponse = await authPost({
    params: { slug: "register-first-admin" },
    request: new Request(registerUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "X-DryCMS-Bootstrap-Token": process.env.DRYCMS_BOOTSTRAP_TOKEN ?? "" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "hunter2-long-password" }),
    }),
    url: registerUrl,
    env: {},
    session: null,
  });
  if (registerResponse.status === 201) return cookiesFrom(registerResponse);

  const loginUrl = new URL(`http://localhost${adminPath}/api/auth/login`);
  const loginResponse = await authPost({
    params: { slug: "login" },
    request: new Request(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "hunter2-long-password" }),
    }),
    url: loginUrl,
    env: {},
    session: null,
  });
  expect(loginResponse.status).toBe(200);
  return cookiesFrom(loginResponse);
}

/** A real browser navigation - the only shape these routes accept. */
function navigation(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "same-origin", ...headers } });
}

const PASSWORD = "hunter2-long-password";

/** A non-super-admin user on a role granting exactly `permissions` (e.g.
 * `[]` for a plain restricted user) - direct against the same content
 * engine the register/login routes above use, since there's no admin UI in
 * this test file to create one through. */
async function createRestrictedUser(email: string, permissions: string[]): Promise<void> {
  const context = { request: new Request("http://localhost"), url: new URL("http://localhost"), params: {}, env: {}, session: null };
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const userType = allTypes.find((t) => t.name === "user")!;
  const roleType = allTypes.find((t) => t.name === "role")!;
  const role = await entries.createEntry(roleType, allTypes, {
    name: `restricted-${Math.random()}`,
    description: "",
    isSuperAdmin: false,
    permissions,
  });
  await entries.createEntry(userType, allTypes, {
    name: "Restricted User",
    email,
    password: { hasExisting: false, new: PASSWORD },
    roles: [role.id],
  });
}

async function loginAs(email: string): Promise<string> {
  const loginUrl = new URL(`http://localhost${adminPath}/api/auth/login`);
  const loginResponse = await authPost({
    params: { slug: "login" },
    request: new Request(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
    url: loginUrl,
    env: {},
    session: null,
  });
  expect(loginResponse.status).toBe(200);
  return cookiesFrom(loginResponse);
}

describe("handleVeiRoute", () => {
  it("ignores everything that isn't one of its two routes", async () => {
    expect(await handleVeiRoute(navigation("http://localhost/"))).toBeNull();
    expect(await handleVeiRoute(navigation(`http://localhost${adminPath}/dashboard`))).toBeNull();
    expect(await handleVeiRoute(navigation(`http://localhost${adminPath}/vei`))).toBeNull();
  });

  it("rejects a non-GET", async () => {
    const response = await handleVeiRoute(new Request(EXIT, { method: "POST" }));
    expect(response?.status).toBe(405);
  });

  it("rejects anything that isn't a top-level navigation", async () => {
    expect((await handleVeiRoute(navigation(EXIT, { "Sec-Fetch-Dest": "image" })))?.status).toBe(403);
    expect((await handleVeiRoute(navigation(EXIT, { "Sec-Fetch-Dest": "empty" })))?.status).toBe(403);
    expect((await handleVeiRoute(navigation(EXIT, { "Sec-Fetch-Site": "cross-site" })))?.status).toBe(403);
  });

  it("allows a client that sends no Sec-Fetch headers at all (curl, tests)", async () => {
    const response = await handleVeiRoute(new Request(EXIT));
    expect(response?.status).toBe(303);
  });

  it("clears the cookie and returns to the given page on exit", async () => {
    const response = await handleVeiRoute(navigation(`${EXIT}?to=%2Fblogs%2Fhello`));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toBe("http://localhost/blogs/hello");
    expect(response?.headers.get("Set-Cookie")).toContain(`${VEI_COOKIE_NAME}=;`);
    expect(response?.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(response?.headers.get("Set-Cookie")).toContain("Path=/");
  });

  it("refuses to redirect off-origin or into the admin app", async () => {
    const offOrigin = await handleVeiRoute(navigation(`${EXIT}?to=%2F%2Fevil.test%2Fx`));
    expect(offOrigin?.headers.get("Location")).toBe("http://localhost/");
    const absolute = await handleVeiRoute(navigation(`${EXIT}?to=https%3A%2F%2Fevil.test`));
    expect(absolute?.headers.get("Location")).toBe("http://localhost/");
    const intoAdmin = await handleVeiRoute(navigation(`${EXIT}?to=${encodeURIComponent(`${adminPath}/dashboard`)}`));
    expect(intoAdmin?.headers.get("Location")).toBe("http://localhost/");
  });

  it("sends an unauthenticated visitor to sign in instead of granting edit mode", async () => {
    const response = await handleVeiRoute(navigation(`${ENTER}?to=%2F`));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toBe(`http://localhost${adminPath}/login`);
    expect(response?.headers.get("Set-Cookie")).toBeNull();
  });

  it("grants edit mode via a session refresh when only the short-lived access cookie is missing", async () => {
    const fullCookie = await adminSessionCookie();
    // The 15-minute `drycms_session` cookie is the one that goes stale while
    // browsing the public site (nothing there rotates it) - simulate exactly
    // that by dropping it and keeping only the 30-day refresh + CSRF cookies
    // a real browser would still be holding.
    const staleCookie = fullCookie
      .split("; ")
      .filter((pair) => !pair.startsWith(`${SESSION_COOKIE_NAME}=`))
      .join("; ");
    expect(staleCookie).not.toContain(SESSION_COOKIE_NAME);

    const response = await handleVeiRoute(navigation(`${ENTER}?to=%2Fblogs%2Fhello`, { Cookie: staleCookie }));
    expect(response?.status).toBe(303);
    // Lands back on the page it was trying to edit, never the admin login.
    expect(response?.headers.get("Location")).toBe("http://localhost/blogs/hello");

    const headers = response?.headers as (Headers & { getSetCookie?: () => string[] }) | undefined;
    const setCookies = headers?.getSetCookie?.() ?? [];
    expect(setCookies.some((cookie) => cookie.startsWith(`${VEI_COOKIE_NAME}=`))).toBe(true);
    // The refresh also re-issues a fresh short-lived access cookie, so the
    // browser doesn't immediately go stale again on the very next click.
    expect(setCookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
  });

  it("still sends to sign-in when even the refresh cookie is gone (a genuine logout)", async () => {
    const fullCookie = await adminSessionCookie();
    const csrfOnly = fullCookie
      .split("; ")
      .filter((pair) => pair.startsWith(`${CSRF_COOKIE_NAME}=`))
      .join("; ");

    const response = await handleVeiRoute(navigation(`${ENTER}?to=%2F`, { Cookie: csrfOnly }));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toBe(`http://localhost${adminPath}/login`);
  });

  it("grants edit mode to any signed-in admin, regardless of their role's grants", async () => {
    await createRestrictedUser("restricted@example.com", []);
    const cookie = await loginAs("restricted@example.com");

    const response = await handleVeiRoute(navigation(`${ENTER}?to=%2F`, { Cookie: cookie }));
    expect(response?.status).toBe(303);
    const headers = response?.headers as (Headers & { getSetCookie?: () => string[] }) | undefined;
    const setCookies = headers?.getSetCookie?.() ?? [];
    expect(setCookies.some((cookie) => cookie.startsWith(`${VEI_COOKIE_NAME}=`))).toBe(true);
  });
});
