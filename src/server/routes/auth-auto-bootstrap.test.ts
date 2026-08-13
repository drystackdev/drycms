import type { DryRouteContext } from "../context.js";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

/**
 * `EMAIL_ADMIN`/`PASSWORD_ADMIN` auto-bootstrap (`routes/auth.ts`'s
 * `maybeAutoBootstrapAdmin`) only ever fires while `hasAnyUser` is still
 * false. `auth.test.ts` shares one DB across its whole file and creates a
 * user partway through, so this behavior needs its own isolated store -
 * same `vi.mock("../config.js", ...)` pattern as `auth.test.ts`, just a
 * fresh temp dir.
 */

const tempDirBox = vi.hoisted(() => ({ path: "" }));
const ORIGINAL_SECRET = process.env.DRYCMS_SECRET_KEY;
const ORIGINAL_BOOTSTRAP = process.env.DRYCMS_BOOTSTRAP_TOKEN;
const ORIGINAL_EMAIL_ADMIN = process.env.EMAIL_ADMIN;
const ORIGINAL_PASSWORD_ADMIN = process.env.PASSWORD_ADMIN;

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-auth-auto-bootstrap-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return { path: resolved.path, content: resolved.content, resolved, pagesSourceStorage: resolved.pagesSource.storage };
});

const seedAssetsBox = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("../../content-types/seed-assets.js", () => ({
  extractPackagedSeedAssets: async (resolved: unknown) => {
    seedAssetsBox.calls.push(resolved);
  },
}));

const { GET } = await import("./auth.js");
const { resolveSession } = await import("../session.js");

beforeEach(() => {
  process.env.DRYCMS_SECRET_KEY = "test-passphrase-do-not-use-in-prod";
  process.env.DRYCMS_BOOTSTRAP_TOKEN = "test-bootstrap-token-do-not-use-in-prod-1234567890";
  // Explicit empty default (not left alone) - `readEnvVar` falls back to the
  // real on-disk `.env` for a truly-absent key, which would pick up
  // whatever EMAIL_ADMIN/PASSWORD_ADMIN a local dev checkout happens to have
  // configured there. Individual tests below still override these to a real
  // value when THEY want auto-bootstrap to actually fire.
  process.env.EMAIL_ADMIN = "";
  process.env.PASSWORD_ADMIN = "";
  seedAssetsBox.calls = [];
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.DRYCMS_SECRET_KEY;
  else process.env.DRYCMS_SECRET_KEY = ORIGINAL_SECRET;
  if (ORIGINAL_BOOTSTRAP === undefined) delete process.env.DRYCMS_BOOTSTRAP_TOKEN;
  else process.env.DRYCMS_BOOTSTRAP_TOKEN = ORIGINAL_BOOTSTRAP;
  if (ORIGINAL_EMAIL_ADMIN === undefined) delete process.env.EMAIL_ADMIN;
  else process.env.EMAIL_ADMIN = ORIGINAL_EMAIL_ADMIN;
  if (ORIGINAL_PASSWORD_ADMIN === undefined) delete process.env.PASSWORD_ADMIN;
  else process.env.PASSWORD_ADMIN = ORIGINAL_PASSWORD_ADMIN;
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function cookieFrom(response: Response): string | undefined {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) return undefined;
  return setCookie.split(";")[0];
}

async function getSession(cookie?: string) {
  const url = new URL("http://localhost/dry/api/auth/session");
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  const request = new Request(url, { headers });
  const session = await resolveSession(request);
  const context: DryRouteContext = { params: { slug: "session" }, request, url, env: {}, session };
  const response = await GET(context);
  return { status: response.status, json: (await response.json()) as any, response };
}

describe("EMAIL_ADMIN/PASSWORD_ADMIN auto-bootstrap", () => {
  it("does nothing when EMAIL_ADMIN/PASSWORD_ADMIN are unset - hasAnyUser stays false", async () => {
    const { json, response } = await getSession();
    expect(json.hasAnyUser).toBe(false);
    expect(json.user).toBeNull();
    expect(response.headers.get("Set-Cookie")).not.toMatch(/^drycms_session=/);
    expect(seedAssetsBox.calls).toHaveLength(0);
  });

  it("falls back to needs-setup when DRYCMS_BOOTSTRAP_TOKEN is missing", async () => {
    // Empty string, not `delete` - `readEnvVar` falls back to reading the
    // real on-disk `.env` for a truly-absent key, which would pick up
    // whatever bootstrap token a local dev checkout happens to have
    // configured there. An explicit empty override reads as "unset"
    // without that fallback (`readEnvVar`'s own `|| undefined`).
    process.env.DRYCMS_BOOTSTRAP_TOKEN = "";
    process.env.EMAIL_ADMIN = "auto-admin@example.com";
    process.env.PASSWORD_ADMIN = "hunter2-long-password";

    const { json } = await getSession();
    expect(json.hasAnyUser).toBe(false);
    expect(json.user).toBeNull();
    expect(seedAssetsBox.calls).toHaveLength(0);
  });

  it("falls back to needs-setup when PASSWORD_ADMIN is shorter than 12 characters", async () => {
    process.env.EMAIL_ADMIN = "auto-admin@example.com";
    process.env.PASSWORD_ADMIN = "short";

    const { json } = await getSession();
    expect(json.hasAnyUser).toBe(false);
    expect(json.user).toBeNull();
    expect(seedAssetsBox.calls).toHaveLength(0);
  });

  it("auto-creates and signs in the first Super Admin when both are set", async () => {
    process.env.EMAIL_ADMIN = "auto-admin@example.com";
    process.env.PASSWORD_ADMIN = "hunter2-long-password";

    const { status, json, response } = await getSession();
    expect(status).toBe(200);
    expect(json.hasAnyUser).toBe(true);
    expect(json.user).toEqual({
      id: expect.any(Number),
      name: "Admin",
      email: "auto-admin@example.com",
      avatar: "",
      roles: ["Super Admin"],
      isSuperAdmin: true,
      permissions: [],
    });
    expect(seedAssetsBox.calls).toHaveLength(1);
    const cookie = cookieFrom(response);
    expect(cookie).toMatch(/^drycms_session=/);

    // Idempotent: a second session check reuses the account instead of
    // creating a second one.
    const again = await getSession(cookie);
    expect(again.json.hasAnyUser).toBe(true);
    expect(again.json.user.email).toBe("auto-admin@example.com");
    expect(seedAssetsBox.calls).toHaveLength(1);
  });
});
