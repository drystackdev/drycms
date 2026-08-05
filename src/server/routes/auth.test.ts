import type { DryRouteContext } from "../context.js";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));
const ORIGINAL_SECRET = process.env.DRYCMS_SECRET_KEY;
const ORIGINAL_BOOTSTRAP = process.env.DRYCMS_BOOTSTRAP_TOKEN;

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-auth-route-"));
  const resolved = resolveOptions({
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    storage: { root: join(tempDirBox.path, "storage") },
  });
  return { path: resolved.path, content: resolved.content, resolved };
});

/** Spies on `register-first-admin`'s call to `extractPackagedSeedAssets` -
 * the real one reads a `seed-assets.zip` from disk next to the compiled
 * `seed-assets.js` module (already covered by `seed-assets.test.ts`'s own
 * unit tests), so this test only needs to verify `routes/auth.ts` calls it
 * with the right argument, at the right point (before the admin account is
 * created - a throw here must leave `hasAnyUser` false). */
const seedAssetsBox = vi.hoisted(() => ({ calls: [] as unknown[], shouldThrow: false }));
vi.mock("../../content-types/seed-assets.js", () => ({
  extractPackagedSeedAssets: async (resolved: unknown) => {
    seedAssetsBox.calls.push(resolved);
    if (seedAssetsBox.shouldThrow) throw new Error("seed-assets extraction boom");
  },
}));

const { GET, POST } = await import("./auth.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");
const { resolveSession } = await import("../session.js");

beforeEach(() => {
  process.env.DRYCMS_SECRET_KEY = "test-passphrase-do-not-use-in-prod";
  process.env.DRYCMS_BOOTSTRAP_TOKEN = "test-bootstrap-token-do-not-use-in-prod-1234567890";
  seedAssetsBox.calls = [];
  seedAssetsBox.shouldThrow = false;
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
  const requestWithBootstrap = opts.slug === "register-first-admin"
    ? new Request(url, {
        method: opts.method ?? "GET",
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        headers: { ...headers, "X-DryCMS-Bootstrap-Token": process.env.DRYCMS_BOOTSTRAP_TOKEN ?? "" },
      })
    : request;
  return { params: { slug: opts.slug }, request: requestWithBootstrap, url, env: {}, session };
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

async function updateProfile(body: unknown, cookie?: string) {
  const response = await POST(await context({ slug: "update-profile", method: "POST", body, cookie }));
  return { status: response.status, json: (await response.json()) as any, response };
}

describe("auth route", () => {
  it("reports hasAnyUser: false and no session before any account exists", async () => {
    const { json } = await getSession();
    expect(json.hasAnyUser).toBe(false);
    expect(json.user).toBeNull();
  });

  it("fails the whole request (and creates no user) if packaged seed-asset extraction throws", async () => {
    seedAssetsBox.shouldThrow = true;
    const { status } = await registerFirstAdmin({
      name: "Should Not Exist",
      email: "should-not-exist@example.com",
      password: "hunter2-long-password",
    });
    expect(status).toBe(500);
    expect(seedAssetsBox.calls).toHaveLength(1);

    // No half-seeded instance left behind - hasAnyUser is still false, so a
    // retry (next POST, seedAssetsBox.shouldThrow reset by beforeEach) can
    // succeed cleanly.
    const { json } = await getSession();
    expect(json.hasAnyUser).toBe(false);
  });

  it("registers the first Super Admin account, assigns the Super Admin role, and signs a session", async () => {
    const { status, json, response } = await registerFirstAdmin({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "hunter2-long-password",
    });
    expect(status).toBe(201);
    // Packaged seed-asset extraction ran exactly once, with the running
    // server's resolved options, before the admin account was created.
    const { resolved } = await import("../config.js");
    expect(seedAssetsBox.calls).toEqual([resolved]);
    expect(json.user).toEqual({
      id: expect.any(Number),
      name: "Ada Lovelace",
      email: "ada@example.com",
      roles: ["Super Admin"],
      isSuperAdmin: true,
      permissions: [],
    });
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
    expect(session.json.user).toEqual({
      id: json.user.id,
      name: "Ada Lovelace",
      email: "ada@example.com",
      roles: ["Super Admin"],
      isSuperAdmin: true,
      permissions: [],
    });
  });

  it("rejects a second register-first-admin attempt once an account exists", async () => {
    const { status, json } = await registerFirstAdmin({ name: "Grace", email: "grace@example.com", password: "hunter2-long-password" });
    expect(status).toBe(409);
    expect(json.error).toBe("already_setup");
  });

  it("logs in with correct credentials and rejects wrong password / unknown email with the same generic message", async () => {
    const ok = await login({ email: "ada@example.com", password: "hunter2-long-password" });
    expect(ok.status).toBe(200);
    expect(ok.json.user.email).toBe("ada@example.com");
    expect(cookieFrom(ok.response)).toMatch(/^drycms_session=/);

    const wrongPassword = await login({ email: "ada@example.com", password: "wrong" });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.json.message).toBe("Invalid email or password.");

    const unknownEmail = await login({ email: "nobody@example.com", password: "hunter2-long-password" });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.json.message).toBe(wrongPassword.json.message);
  });

  it("update-profile requires a session, and a password change requires + verifies the current password", async () => {
    const { cookie } = await (async () => {
      const res = await login({ email: "ada@example.com", password: "hunter2-long-password" });
      return { cookie: cookieFrom(res.response)! };
    })();

    const noSession = await updateProfile({ name: "Ada", email: "ada@example.com" });
    expect(noSession.status).toBe(401);

    // Renaming/re-emailing alone (both password fields left blank) doesn't
    // touch the password at all.
    const renamed = await updateProfile({ name: "Ada L.", email: "ada@example.com" }, cookie);
    expect(renamed.status).toBe(200);
    expect(renamed.json.user).toEqual({
      id: expect.any(Number),
      name: "Ada L.",
      email: "ada@example.com",
      roles: ["Super Admin"],
      isSuperAdmin: true,
      permissions: [],
    });
    const stillOldPassword = await login({ email: "ada@example.com", password: "hunter2-long-password" });
    expect(stillOldPassword.status).toBe(200);

    // A new password without the current one is a validation error, not a
    // silently-ignored no-op - the field is highlighted for the form.
    const missingCurrent = await updateProfile(
      { name: "Ada L.", email: "ada@example.com", newPassword: "hunter3" },
      cookie,
    );
    expect(missingCurrent.status).toBe(422);
    expect(missingCurrent.json.fieldErrors).toEqual({ currentPassword: "Enter your current password." });

    // The wrong current password is rejected without changing anything.
    const wrongCurrent = await updateProfile(
      { name: "Ada L.", email: "ada@example.com", currentPassword: "nope", newPassword: "hunter3" },
      cookie,
    );
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.json.fieldErrors).toEqual({ currentPassword: "Incorrect current password." });
    const oldPasswordStillWorks = await login({ email: "ada@example.com", password: "hunter2-long-password" });
    expect(oldPasswordStillWorks.status).toBe(200);

    // The correct current password lets the new one take effect.
    const changed = await updateProfile(
      { name: "Ada L.", email: "ada@example.com", currentPassword: "hunter2-long-password", newPassword: "hunter3-long-password" },
      cookie,
    );
    expect(changed.status).toBe(200);
    const oldPasswordRejected = await login({ email: "ada@example.com", password: "hunter2-long-password" });
    expect(oldPasswordRejected.status).toBe(401);
    const newPasswordWorks = await login({ email: "ada@example.com", password: "hunter3-long-password" });
    expect(newPasswordWorks.status).toBe(200);
  });

  it("logout clears the session cookie", async () => {
    const { status, response } = await logout("drycms_session=whatever");
    expect(status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
  });
});
