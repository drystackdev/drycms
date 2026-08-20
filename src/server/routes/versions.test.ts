import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `routes/versions.ts`'s two very different gates (`status/git-versions-page.md`):
 * reading the history needs the Git Sync setting grant, restoring needs the
 * code-edit AND content-type grants on top - a split that only exists here,
 * so it is the thing worth pinning down.
 */
const tempDirBox = vi.hoisted(() => ({ contentDir: "", pagesSourceDir: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.contentDir = mkdtempSync(join(tmpdir(), "drycms-versions-content-"));
  tempDirBox.pagesSourceDir = mkdtempSync(join(tmpdir(), "drycms-versions-pages-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.contentDir });
  return {
    content: { engine: "sqlite", file: join(tempDirBox.contentDir, "content.sqlite") },
    typesCacheStorage: resolved.typesCache.storage,
    pagesSourceStorage: { kind: "local", root: tempDirBox.pagesSourceDir },
  };
});

const { GET, POST } = await import("./versions.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { createStorageSchemaDocumentStore } = await import("../schema-document-storage.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.contentDir, { recursive: true, force: true });
  await rm(tempDirBox.pagesSourceDir, { recursive: true, force: true });
});

let superAdmin: SessionPayload;
let contentOnly: SessionPayload;

beforeAll(async () => {
  const schema = createContentEngineAdapter(content, undefined, createStorageSchemaDocumentStore({ env: {} }));
  const entries = createContentEntryEngineAdapter(content);
  const allTypes = await schema.listContentTypes();
  const userType = allTypes.find((t) => t.name === "user")!;
  const roleType = allTypes.find((t) => t.name === "role")!;

  const adminRole = await entries.createEntry(roleType, allTypes, { name: "Versions Super Admin", description: "", isSuperAdmin: true, permissions: [] });
  const admin = await entries.createEntry(userType, allTypes, {
    name: "Admin",
    email: "versions-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [adminRole.id],
  });
  superAdmin = { id: admin.id, name: "Admin", email: "versions-admin@example.com" };

  const plainRole = await entries.createEntry(roleType, allTypes, { name: "Versions Reader", description: "", isSuperAdmin: false, permissions: [] });
  const reader = await entries.createEntry(userType, allTypes, {
    name: "Reader",
    email: "versions-reader@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [plainRole.id],
  });
  contentOnly = { id: reader.id, name: "Reader", email: "versions-reader@example.com" };
});

function get(session: SessionPayload, url = "http://localhost/dry/api/versions", slug?: string): Promise<Response> {
  const request = new Request(url);
  return GET({ params: { slug }, request, url: new URL(url), env: {}, session } as DryRouteContext);
}

function post(session: SessionPayload, body: unknown, slug = "restore"): Promise<Response> {
  const url = "http://localhost/dry/api/versions/restore";
  const request = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return POST({ params: { slug }, request, url: new URL(url), env: {}, session } as DryRouteContext);
}

describe("versions route", () => {
  it("reports 'not configured' rather than failing when no repository is connected", async () => {
    const response = await get(superAdmin);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: false, commits: [] });
  });

  it("refuses a read from a role with no Git Sync setting grant", async () => {
    const response = await get(contentOnly);
    expect(response.status).toBe(403);
  });

  it("refuses a restore from a role without the code-edit and content-type grants", async () => {
    const response = await post(contentOnly, { sha: "abcdef1", mode: "plan" });
    expect(response.status).toBe(403);
  });

  it("rejects a malformed sha before touching git", async () => {
    const response = await post(superAdmin, { sha: "not a sha", mode: "plan" });
    expect(response.status).toBe(400);
  });

  it("answers 412 for a restore while no repository is connected", async () => {
    const response = await post(superAdmin, { sha: "abcdef1234", mode: "plan" });
    expect(response.status).toBe(412);
  });

  it("404s an unknown POST operation", async () => {
    const response = await post(superAdmin, { sha: "abcdef1234" }, "rewind");
    expect(response.status).toBe(404);
  });
});
