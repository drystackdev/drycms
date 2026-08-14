import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeCallLog } from "../app-router/dry-replay-codec.js";
import { PAGE_BUILDER_RESOURCE_ID, permissionKeyFor } from "../../content-types/permissions.js";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-dry-http-route-"));
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { POST } = await import("./dry-http.js");
const { createContentEntryEngineAdapter, createContentEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

/** Every pre-existing test in this file assumes "this succeeds" - now that
 * `dry-http` is permission-checked per resource (see
 * `content-types/access.ts`), that assumption only holds for a Super Admin,
 * same reasoning + same seeding pattern as `content-entries.test.ts`. */
let superAdminSession: SessionPayload;
/** A session whose role has NO permissions at all - the baseline denial
 * case (distinct from `session: null`, which is "not logged in"). */
let noPermissionSession: SessionPayload;
/** A session whose role can only `view` the `role` collection - exercises
 * the new "code + content = page" per-resource grant: this should read
 * `role` fine but still be denied `systemSettings`. */
let roleViewerSession: SessionPayload;
/** A session whose role only holds the code-edit permission
 * (`PAGE_BUILDER_RESOURCE_ID`) - should read ANY resource regardless of its
 * own per-type grants, same as before this authorization existed. */
let codePermissionSession: SessionPayload;

beforeAll(async () => {
  const schema = createContentEngineAdapter(content);
  const entries = createContentEntryEngineAdapter(content);
  const allTypes = await schema.listContentTypes();
  const userType = allTypes.find((t) => t.name === "user")!;
  const roleType = allTypes.find((t) => t.name === "role")!;

  async function makeSession(email: string, roleValue: Record<string, unknown>): Promise<SessionPayload> {
    const role = await entries.createEntry(roleType, allTypes, { name: email, description: "", isSuperAdmin: false, permissions: [], ...roleValue });
    const user = await entries.createEntry(userType, allTypes, {
      name: email,
      email,
      password: { hasExisting: false, new: "hunter2" },
      roles: [role.id],
    });
    return { id: user.id, name: email, email };
  }

  superAdminSession = await makeSession("dry-http-super-admin@example.com", { isSuperAdmin: true });
  noPermissionSession = await makeSession("dry-http-no-permission@example.com", {});
  roleViewerSession = await makeSession("dry-http-role-viewer@example.com", {
    permissions: [permissionKeyFor(roleType.id, "view")],
  });
  codePermissionSession = await makeSession("dry-http-code-permission@example.com", {
    permissions: [permissionKeyFor(PAGE_BUILDER_RESOURCE_ID, "setting")],
  });
});

function context(body: unknown, session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/dry-http");
  const request = new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { params: {}, request, url, env: {}, session };
}

describe("POST /dry/api/dry-http", () => {
  it("reads a singleton and reports its resource + version in headers", async () => {
    const response = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Dry-Resource")).toBe("systemSettings");
    // "1", not "0" - `dry().singleton().get()` never returns null, so this
    // first read itself lazily creates the row (bumping the version once).
    expect(response.headers.get("X-Dry-Resource-Version")).toBe("1");
    const [entry] = decodeCallLog(await response.text());
    expect(entry).toMatchObject({ kind: "singleton", name: "systemSettings", method: "get" });
  });

  it("bumps X-Dry-Resource-Version after the resource's data actually changes", async () => {
    const entries = createContentEntryEngineAdapter(content);
    const schema = createContentEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const systemSettingsType = allTypes.find((t) => t.name === "systemSettings")!;

    const before = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }));
    const versionBefore = before.headers.get("X-Dry-Resource-Version");

    await entries.saveSingletonEntry(systemSettingsType, allTypes, { data: "changed" });

    const after = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }));
    expect(after.headers.get("X-Dry-Resource-Version")).not.toBe(versionBefore);
  });

  it("rejects a malformed body instead of throwing an unhandled error", async () => {
    const response = await POST(context({ kind: "nonsense", name: 42 }));
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("internal");
  });

  it("a collection get() by unknown id returns a null result, not an error", async () => {
    const response = await POST(context({ kind: "collection", name: "role", method: "get", idOrSlug: 999999 }));
    expect(response.status).toBe(200);
    const [entry] = decodeCallLog(await response.text());
    expect(entry!.result).toBeNull();
  });

  describe("authorization - per-resource, not just the code-edit permission", () => {
    it("401s an unauthenticated request", async () => {
      const response = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }, null));
      expect(response.status).toBe(401);
    });

    it("403s a session with no permissions at all", async () => {
      const response = await POST(context({ kind: "collection", name: "role", method: "list" }, noPermissionSession));
      expect(response.status).toBe(403);
    });

    it("allows a session with only `view` on the queried collection", async () => {
      const response = await POST(context({ kind: "collection", name: "role", method: "list" }, roleViewerSession));
      expect(response.status).toBe(200);
    });

    it("still denies that same session a DIFFERENT resource it wasn't granted `view` on", async () => {
      const response = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }, roleViewerSession));
      expect(response.status).toBe(403);
    });

    it("allows a session with only the code-edit permission to query ANY resource", async () => {
      const response = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }, codePermissionSession));
      expect(response.status).toBe(200);
    });
  });
});
