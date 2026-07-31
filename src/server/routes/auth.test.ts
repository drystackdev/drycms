import type { DryRouteContext } from "../context.js";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));
const ORIGINAL_SECRET = process.env.DRYCMS_SECRET_KEY;

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-auth-route-"));
  return { path: "/dry", content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { GET, POST } = await import("./auth.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");
const { resolveSession } = await import("../session.js");

beforeEach(() => {
  process.env.DRYCMS_SECRET_KEY = "test-passphrase-do-not-use-in-prod";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.DRYCMS_SECRET_KEY;
  else process.env.DRYCMS_SECRET_KEY = ORIGINAL_SECRET;
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

/** Resolves `session` the same way `handler.ts` would before dispatch (via
 * `server/session.ts`'s `resolveSession`) - `auth.ts`'s own `GET session`
 * handler now reads `context.session` directly instead of re-parsing the
 * cookie itself, so a direct-call test has to replicate that one step. */
async function context(opts: { slug?: string; method?: string; body?: unknown; cookie?: string }): Promise<DryRouteContext> {
  const url = new URL(`http://localhost/dry/api/auth/${opts.slug ?? ""}`);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  const request = new Request(url, {
    method: opts.method ?? "GET",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    headers,
  });
  const session = await resolveSession(request);
  return { params: { slug: opts.slug }, request, url, env: {}, session };
}

/** Extracts just the `drycms_session=...` pair (no attributes) from a
 * `Set-Cookie` response header, ready to send back as the next request's
 * `Cookie` header - a real browser does this automatically, this test harness
 * has to do it by hand. */
function cookieFrom(response: Response): string | undefined {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) return undefined;
  return setCookie.split(";")[0];
}

async function getSession(cookie?: string) {
  const response = await GET(await context({ slug: "session", cookie }));
  return { status: response.status, json: (await response.json()) as any, response };
}

async function registerFirstAdmin(body: unknown) {
  const response = await POST(await context({ slug: "register-first-admin", method: "POST", body }));
  return { status: response.status, json: (await response.json()) as any, response };
}

async function login(body: unknown) {
  const response = await POST(await context({ slug: "login", method: "POST", body }));
  return { status: response.status, json: (await response.json()) as any, response };
}

async function logout(cookie?: string) {
  const response = await POST(await context({ slug: "logout", method: "POST", cookie }));
  return { status: response.status, response };
}

describe("auth route", () => {
  it("reports hasAnyUser: false and no session before any account exists", async () => {
    const { json } = await getSession();
    expect(json.hasAnyUser).toBe(false);
    expect(json.user).toBeNull();
  });

  it("registers the first Super Admin account, assigns the Super Admin role, and signs a session", async () => {
    const { status, json, response } = await registerFirstAdmin({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "hunter2",
    });
    expect(status).toBe(201);
    expect(json.user).toEqual({ id: expect.any(Number), name: "Ada Lovelace", email: "ada@example.com" });
    const cookie = cookieFrom(response);
    expect(cookie).toMatch(/^drycms_session=/);

    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;
    const superAdminRole = (await entries.listEntries(roleType, allTypes, { page: 0, pageSize: 10 })).rows.find(
      (r) => r.value.name === "Super Admin",
    )!;
    const createdUser = await entries.getEntry(userType, allTypes, json.user.id);
    expect(createdUser?.value.roles).toEqual([superAdminRole.id]);

    const session = await getSession(cookie);
    expect(session.json.hasAnyUser).toBe(true);
    expect(session.json.user).toEqual({ id: json.user.id, name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("rejects a second register-first-admin attempt once an account exists", async () => {
    const { status, json } = await registerFirstAdmin({ name: "Grace", email: "grace@example.com", password: "hunter2" });
    expect(status).toBe(409);
    expect(json.error).toBe("already_setup");
  });

  it("logs in with correct credentials and rejects wrong password / unknown email with the same generic message", async () => {
    const ok = await login({ email: "ada@example.com", password: "hunter2" });
    expect(ok.status).toBe(200);
    expect(ok.json.user.email).toBe("ada@example.com");
    expect(cookieFrom(ok.response)).toMatch(/^drycms_session=/);

    const wrongPassword = await login({ email: "ada@example.com", password: "wrong" });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.json.message).toBe("Invalid email or password.");

    const unknownEmail = await login({ email: "nobody@example.com", password: "hunter2" });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.json.message).toBe(wrongPassword.json.message);
  });

  it("logout clears the session cookie", async () => {
    const { status, response } = await logout("drycms_session=whatever");
    expect(status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
  });
});
