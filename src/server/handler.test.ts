import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));
const ORIGINAL_SECRET = process.env.DRYCMS_SECRET_KEY;

/**
 * `handler.ts` transitively imports EVERY route module (`API_ROUTES`), so -
 * unlike a single-route test file, which only needs to mock the config
 * fields THAT route reads - this mock has to provide every named export
 * `config.ts` re-exports from `resolveOptions()`, or an unrelated route
 * module destructuring one at import time would blow up before any test
 * even runs. `overrides.localDataRoot` (see `options.test.ts`) points every
 * local storage/content/kv root at one throwaway temp dir in one shot.
 */
vi.mock("./config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("./options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-handler-route-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return {
    path: resolved.path,
    storage: resolved.storage,
    icons: resolved.icons,
    content: resolved.content,
    ai: resolved.ai,
    kv: resolved.kv,
    lang: resolved.lang,
    componentsStorage: resolved.components.storage,
    pagesCacheStorage: resolved.pagesCache.storage,
    pagesCacheEdgeTtl: resolved.pagesCache.edgeTtl,
    typesCacheStorage: resolved.typesCache.storage,
    pagesSourceStorage: resolved.pagesSource.storage,
    resolved,
  };
});

const { isApiRequest, handleApiRequest } = await import("./handler.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../content-types/engine/index.js");
const { content, path: adminPath } = await import("./config.js");
const { PAGE_BUILDER_RESOURCE_ID, permissionKeyFor } = await import("../content-types/permissions.js");
const { createCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } = await import("./csrf.js");

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

describe("isApiRequest", () => {
  it("matches the bare /api root and any /api/* path, nothing else", () => {
    expect(isApiRequest(`${adminPath}/api`)).toBe(true);
    expect(isApiRequest(`${adminPath}/api/pages-build`)).toBe(true);
    expect(isApiRequest(`${adminPath}/dashboard`)).toBe(false);
  });
});

/** Extracts just the `drycms_session=...` pair from a `Set-Cookie` response
 * header, same helper `routes/auth.test.ts` uses - a real browser does this
 * automatically, this test harness has to do it by hand. */
function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("Login did not set a session cookie.");
  return setCookie.split(";")[0]!;
}

async function loginAs(email: string, password: string): Promise<string> {
  const request = new Request(`http://localhost${adminPath}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const response = await handleApiRequest(request);
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

function get(urlPath: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  return handleApiRequest(new Request(`http://localhost${adminPath}${urlPath}`, { headers }));
}

describe("handleApiRequest - dispatcher-level authorization for the 'code + content = page' split", () => {
  const PASSWORD = "hunter2-long-password";
  let contentOnlyCookie: string;
  let codePermissionCookie: string;

  beforeAll(async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;

    async function makeUser(email: string, permissions: string[]): Promise<void> {
      const role = await entries.createEntry(roleType, allTypes, { name: email, description: "", isSuperAdmin: false, permissions });
      await entries.createEntry(userType, allTypes, {
        name: email,
        email,
        password: { hasExisting: false, new: PASSWORD },
        roles: [role.id],
      });
    }

    // Can view/edit the `role` collection, but holds NEITHER the old
    // blanket `PAGE_BUILDER_RESOURCE_ID` gate nor any build-specific grant -
    // exactly the role this whole change is about.
    await makeUser("handler-content-only@example.com", [
      permissionKeyFor(roleType.id, "view"),
      permissionKeyFor(roleType.id, "update"),
    ]);
    // The code-edit permission only - equivalent to the OLD sole gate.
    await makeUser("handler-code-permission@example.com", [permissionKeyFor(PAGE_BUILDER_RESOURCE_ID, "setting")]);

    contentOnlyCookie = await loginAs("handler-content-only@example.com", PASSWORD);
    codePermissionCookie = await loginAs("handler-code-permission@example.com", PASSWORD);
  });

  it("401s an unauthenticated request before it ever reaches a route", async () => {
    const response = await get("/api/pages-build?byResource=role");
    expect(response.status).toBe(401);
  });

  it("dry-http and pages-build are no longer blanket-gated on the code-edit permission - a content-only session reaches the route", async () => {
    const pagesBuild = await get("/api/pages-build?byResource=role", contentOnlyCookie);
    expect(pagesBuild.status).toBe(200);

    // POST needs a valid double-submit CSRF pair too (`csrf.ts`'s
    // `requiresCsrf` - only `auth/login` is exempt among mutating methods),
    // on top of the session cookie - a real browser would already carry
    // this from an earlier page load.
    const csrfToken = createCsrfToken();
    const dryHttp = await handleApiRequest(
      new Request(`http://localhost${adminPath}/api/dry-http`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: `${contentOnlyCookie}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
          [CSRF_HEADER_NAME]: csrfToken,
        },
        body: JSON.stringify({ kind: "collection", name: "role", method: "list" }),
      }),
    );
    // Reaches the route's OWN per-type check (`dry-http.ts`), which allows
    // it - `role:view` is exactly what was granted above.
    expect(dryHttp.status).toBe(200);
  });

  it("github-restore stays code-edit-permission-only at the dispatcher, unaffected by the split", async () => {
    const denied = await get("/api/github-restore", contentOnlyCookie);
    expect(denied.status).toBe(403);

    const allowed = await get("/api/github-restore", codePermissionCookie);
    // Passed the dispatcher's gate - GitHub Sync just isn't configured in
    // this test env, which the route reports as a normal 200 payload
    // (`configured: false`), not a 401/403.
    expect(allowed.status).toBe(200);
    expect(allowed.status).not.toBe(403);
  });
});
