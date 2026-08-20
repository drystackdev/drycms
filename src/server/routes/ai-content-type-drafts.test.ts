import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-ai-drafts-route-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") }, pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") }, typesCacheStorage: resolved.typesCache.storage };
});

const { GET, DELETE } = await import("./ai-content-type-drafts.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { createStorageSchemaDocumentStore } = await import("../schema-document-storage.js");
/** The engine adapters this file builds by hand must read and write the SAME
 * `content/types.json` the route handlers under test do - a default in-memory
 * document would make each side seed its own schema over the other's tables. */
const docStore = () => createStorageSchemaDocumentStore({ env: {} });
const { content } = await import("../config.js");
const { saveAiContentTypeDraft } = await import("../ai-content-type-drafts.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

let superAdminSession: SessionPayload;

beforeAll(async () => {
  const schema = createContentEngineAdapter(content, undefined, docStore());
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
    email: "ai-drafts-route-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "ai-drafts-route-admin@example.com" };
});

function context(ifVersion?: number): DryRouteContext {
  const url = new URL("http://localhost/dry/api/ai-content-type-drafts");
  const headers: Record<string, string> = {};
  if (ifVersion !== undefined) headers["X-Data-Version"] = String(ifVersion);
  const request = new Request(url, { method: "GET", headers });
  return { params: {}, request, url, env: {}, session: superAdminSession };
}

describe("GET /dry/api/ai-content-type-drafts - data-version protocol", () => {
  it("always includes version/changed:true on a first (unversioned) request, even with nothing pending", async () => {
    const response = await GET(context());
    const json = (await response.json()) as any;
    expect(json.changed).toBe(true);
    expect(typeof json.version).toBe("number");
    expect(json.drafts).toEqual([]);
  });

  it("a stale X-Data-Version after a new proposal returns changed+drafts; the fresh version that follows returns changed:false with no drafts array", async () => {
    const before = (await (await GET(context())).json()).version as number;

    await saveAiContentTypeDraft(
      superAdminSession.id,
      { id: "route-d1", definition: { id: "route-d1", kind: "collection", name: "routepost", label: "routepost", fields: [], version: 0 } as any, isNew: true, createdAt: new Date().toISOString() },
      {},
    );

    const stale = await (await GET(context(before))).json();
    expect(stale.changed).toBe(true);
    expect(stale.version).toBeGreaterThan(before);
    expect(stale.drafts.some((d: any) => d.id === "route-d1")).toBe(true);

    const fresh = await (await GET(context(stale.version))).json();
    expect(fresh).toEqual({ changed: false, version: stale.version });
    expect(fresh.drafts).toBeUndefined();
  });

  it("deleting the draft bumps the version again, invalidating the previously-fresh one", async () => {
    const beforeDelete = (await (await GET(context())).json()).version as number;

    const delResponse = await DELETE({ ...context(), params: { slug: "route-d1" }, request: new Request("http://localhost/dry/api/ai-content-type-drafts/route-d1", { method: "DELETE" }) });
    expect(delResponse.status).toBe(204);

    const after = await (await GET(context(beforeDelete))).json();
    expect(after.changed).toBe(true);
    expect(after.version).toBeGreaterThan(beforeDelete);
    expect(after.drafts.some((d: any) => d.id === "route-d1")).toBe(false);
  });
});
