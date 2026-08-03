import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { encodeEntryId } from "../../lib/id-hash.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-content-entries-route-"));
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { GET, POST, PUT, PATCH } = await import("./content-entries.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

/** Every existing test in this file assumes "this succeeds" - now that
 * content CRUD is permission-checked (see `content-types/access.ts`), that
 * assumption only holds for a Super Admin. Seeded once, reused as
 * `context()`'s default `session` so none of those tests had to change; the
 * "authorization" describe block below covers the denial paths explicitly. */
let superAdminSession: SessionPayload;

beforeAll(async () => {
  const schema = createContentEngineAdapter(content);
  const entries = createContentEntryEngineAdapter(content);
  const allTypes = await schema.listContentTypes();
  const userType = allTypes.find((t) => t.name === "user")!;
  const roleType = allTypes.find((t) => t.name === "role")!;

  const role = await entries.createEntry(roleType, allTypes, {
    name: "Test Super Admin",
    description: "",
    isSuperAdmin: true,
    permissions: [],
  });
  const user = await entries.createEntry(userType, allTypes, {
    name: "Test Admin",
    email: "test-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "test-admin@example.com" };
});

function context(opts: {
  slug?: string;
  method?: string;
  body?: string;
  ifVersion?: number;
  session?: SessionPayload | null;
}): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/content/${opts.slug ?? ""}`);
  const headers: Record<string, string> = {};
  if (opts.body) headers["content-type"] = "application/json";
  if (opts.ifVersion !== undefined) headers["X-Data-Version"] = String(opts.ifVersion);
  const request = new Request(url, { method: opts.method ?? "GET", body: opts.body, headers });
  const session = opts.session !== undefined ? opts.session : superAdminSession;
  return { params: { slug: opts.slug }, request, url, env: {}, session };
}

async function get(slug: string, ifVersion?: number, session?: SessionPayload | null) {
  const response = await GET(context({ slug, ifVersion, session }));
  return { status: response.status, json: (await response.json()) as any };
}

async function post(slug: string, body: unknown, session?: SessionPayload | null) {
  const response = await POST(context({ slug, method: "POST", body: JSON.stringify(body), session }));
  return { status: response.status, json: (await response.json()) as any };
}

async function patch(slug: string, body: unknown) {
  const response = await PATCH(context({ slug, method: "PATCH", body: JSON.stringify(body) }));
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as any) };
}

async function put(slug: string, body: unknown, session?: SessionPayload | null) {
  const response = await PUT(context({ slug, method: "PUT", body: JSON.stringify(body), session }));
  return { status: response.status, json: (await response.json()) as any };
}

describe("content-entries route - data-version protocol", () => {
  it("GET list always includes `version`, `changed: true`, and data when no X-Data-Version is sent", async () => {
    const { json } = await get("role");
    expect(json.changed).toBe(true);
    expect(typeof json.version).toBe("number");
    expect(Array.isArray(json.rows)).toBe(true);
  });

  it("bumps `version` on create, then GET with a stale X-Data-Version returns changed+data while a fresh one returns changed:false with no rows", async () => {
    const before = (await get("role")).json.version as number;

    const created = await post("role", { name: "Editor", isSuperAdmin: false, permissions: [] });
    expect(created.status).toBe(201);

    const stale = await get("role", before);
    expect(stale.json.changed).toBe(true);
    expect(stale.json.version).toBe(before + 1);
    expect(stale.json.rows.some((r: any) => r.value.name === "Editor")).toBe(true);

    const fresh = await get("role", stale.json.version);
    expect(fresh.json).toEqual({ changed: false, version: stale.json.version });
    expect(fresh.json.rows).toBeUndefined();
  });

  it("hides the seeded Super Admin role from role/user lists", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    await entries.createEntry(userType, allTypes, {
      name: "Plain User",
      email: "plain-user@example.com",
      password: { hasExisting: false, new: "hunter2" },
      roles: [],
    });

    const roles = await get("role");
    expect(roles.json.rows.some((r: any) => r.value.name === "Super Admin")).toBe(false);

    const users = await get("user");
    expect(users.json.rows.some((r: any) => r.value.email === "test-admin@example.com")).toBe(false);
    expect(users.json.rows.some((r: any) => r.value.email === "plain-user@example.com")).toBe(true);
  });

  it("returns not_found for a direct GET of the seeded Super Admin role", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const roleType = allTypes.find((t) => t.name === "role")!;
    const rolePage = await entries.listEntries(roleType, allTypes, { page: 0, pageSize: 10 });
    const superAdmin = rolePage.rows.find((row) => row.value.isSuperAdmin === true)!;

    const response = await get(`role/${superAdmin.id}`);
    expect(response.status).toBe(404);
  });

  it("GET single entry by id honors the same version protocol", async () => {
    const created = await post("role", { name: "Viewer", isSuperAdmin: false, permissions: [] });
    const id = created.json.entry.id as string;

    const first = await get(`role/${id}`);
    expect(first.json.changed).toBe(true);
    expect(first.json.entry.value.name).toBe("Viewer");

    const unchanged = await get(`role/${id}`, first.json.version);
    expect(unchanged.json).toEqual({ changed: false, version: first.json.version });
  });
});

describe("content-entries route - PATCH (reorder)", () => {
  it("bulk-persists sortIndex for a features.sortable collection, and rejects one that isn't sortable", async () => {
    const schema = createContentEngineAdapter(content);
    const item = {
      id: "custom-item",
      kind: "collection" as const,
      name: "item",
      label: "Item",
      features: { sortable: true },
      fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(item, await schema.planSave(item));

    const a = (await post("item", { name: "A" })).json.entry;
    const b = (await post("item", { name: "B" })).json.entry;

    const reordered = await patch("item", {
      updates: [
        { id: b.id, sortIndex: 0 },
        { id: a.id, sortIndex: 1 },
      ],
    });
    expect(reordered.status).toBe(204);

    const listed = await get("item");
    expect(
      listed.json.rows
        .slice()
        .sort((x: any, y: any) => x.value.sortIndex - y.value.sortIndex)
        .map((r: any) => r.value.name),
    ).toEqual(["B", "A"]);

    const rejected = await patch("role", { updates: [] });
    expect(rejected.status).toBe(501);
  });
});

describe("content-entries route - authorization", () => {
  it("401s every verb with no session", async () => {
    expect((await get("role", undefined, null)).status).toBe(401);
    expect((await post("role", { name: "X", isSuperAdmin: false, permissions: [] }, null)).status).toBe(401);
  });

  it("403s a session with no grant on the resource, and allows only the specifically-granted action", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;
    const permissionKey = `${roleType.id}:view`;

    // No role at all - denied outright.
    const noRoleUser = await entries.createEntry(userType, allTypes, {
      name: "No Role",
      email: "no-role@example.com",
      password: { hasExisting: false, new: "hunter2" },
      roles: [],
    });
    const noRoleSession: SessionPayload = { id: noRoleUser.id, name: "No Role", email: "no-role@example.com" };
    expect((await get("role", undefined, noRoleSession)).status).toBe(403);

    // A role granting only "view" on "role" - view passes, create still 403s.
    const viewerRole = await entries.createEntry(roleType, allTypes, {
      name: "Role Viewer",
      description: "",
      isSuperAdmin: false,
      permissions: [permissionKey],
    });
    const viewerUser = await entries.createEntry(userType, allTypes, {
      name: "Viewer",
      email: "viewer@example.com",
      password: { hasExisting: false, new: "hunter2" },
      roles: [viewerRole.id],
    });
    const viewerSession: SessionPayload = { id: viewerUser.id, name: "Viewer", email: "viewer@example.com" };

    expect((await get("role", undefined, viewerSession)).status).toBe(200);
    expect((await post("role", { name: "Should fail", isSuperAdmin: false, permissions: [] }, viewerSession)).status).toBe(403);

    const roleManager = await entries.createEntry(roleType, allTypes, {
      name: "Role Manager",
      description: "",
      isSuperAdmin: false,
      permissions: [`${roleType.id}:create`, `${roleType.id}:update`],
    });
    const roleManagerUser = await entries.createEntry(userType, allTypes, {
      name: "Role Manager User",
      email: "role-manager@example.com",
      password: { hasExisting: false, new: "hunter2" },
      roles: [roleManager.id],
    });
    const roleManagerSession: SessionPayload = { id: roleManagerUser.id, name: "Role Manager User", email: "role-manager@example.com" };
    expect((await post("role", { name: "Forged Super Admin", isSuperAdmin: true, permissions: [] }, roleManagerSession)).status).toBe(403);
  });

  it("hides a Super Admin's own `user` row from a delegated admin's direct-by-id GET, and blocks editing it even with roles unchanged", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;

    const userManagerRole = await entries.createEntry(roleType, allTypes, {
      name: "User Manager",
      description: "",
      isSuperAdmin: false,
      permissions: [`${userType.id}:view`, `${userType.id}:update`],
    });
    const userManager = await entries.createEntry(userType, allTypes, {
      name: "User Manager User",
      email: "user-manager@example.com",
      password: { hasExisting: false, new: "hunter2" },
      roles: [userManagerRole.id],
    });
    const userManagerSession: SessionPayload = { id: userManager.id, name: "User Manager User", email: "user-manager@example.com" };

    const superAdminUserSlug = `user/${encodeEntryId(superAdminSession.id)}`;

    // Direct-by-id GET must 404, matching the list, which already hides it.
    expect((await get(superAdminUserSlug, undefined, userManagerSession)).status).toBe(404);

    // A crafted PUT resubmitting the Super Admin's own unchanged roles - only
    // `email` differs - must still be rejected, not just role/password edits.
    const superAdminRow = await entries.getEntry(userType, allTypes, superAdminSession.id);
    const attempted = await put(
      superAdminUserSlug,
      { ...superAdminRow!.value, email: "hijacked@example.com" },
      userManagerSession,
    );
    expect(attempted.status).toBe(403);

    const stillOriginal = await entries.getEntry(userType, allTypes, superAdminSession.id);
    expect(stillOriginal!.value.email).toBe("test-admin@example.com");
  });

  it("requires publish permission when a draft-enabled entry is published", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const userType = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;
    const article = {
      id: "publishable-article",
      kind: "collection" as const,
      name: "publishableArticle",
      label: "Publishable Article",
      features: { draft: true },
      fields: [{ id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(article, await schema.planSave(article));
    const editorRole = await entries.createEntry(roleType, allTypes, {
      name: "Draft Editor",
      description: "",
      isSuperAdmin: false,
      permissions: [`${article.id}:create`, `${article.id}:update`],
    });
    const editor = await entries.createEntry(userType, allTypes, {
      name: "Draft Editor User",
      email: "draft-editor@example.com",
      password: { hasExisting: false, new: "hunter2" },
      roles: [editorRole.id],
    });
    const editorSession: SessionPayload = { id: editor.id, name: "Draft Editor User", email: "draft-editor@example.com" };

    const draft = await post(article.name, { title: "Draft", draft: true }, editorSession);
    expect(draft.status).toBe(201);
    const published = await post(article.name, { title: "Published", draft: false }, editorSession);
    expect(published.status).toBe(403);
    const draftId = draft.json.entry.id as string;
    expect((await put(`${article.name}/${draftId}`, { title: "Still draft", draft: true }, editorSession)).status).toBe(200);
    expect((await put(`${article.name}/${draftId}`, { title: "Now published", draft: false }, editorSession)).status).toBe(403);
  });
});
