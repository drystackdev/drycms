import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-ai-page-source-flags-route-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") }, typesCacheStorage: resolved.typesCache.storage };
});

const { GET } = await import("./ai-page-source-flags.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");
const { markAiPageSourceWrite } = await import("../ai-page-source-flags.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

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
    email: "ai-page-source-flags-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "ai-page-source-flags-admin@example.com" };
});

function context(ifVersion?: number): DryRouteContext {
  const url = new URL("http://localhost/dry/api/ai-page-source-flags");
  const headers: Record<string, string> = {};
  if (ifVersion !== undefined) headers["X-Data-Version"] = String(ifVersion);
  const request = new Request(url, { method: "GET", headers });
  return { params: {}, request, url, env: {}, session: superAdminSession };
}

describe("GET /dry/api/ai-page-source-flags - data-version protocol", () => {
  it("always includes version/changed:true on a first (unversioned) request", async () => {
    const json = (await (await GET(context())).json()) as any;
    expect(json.changed).toBe(true);
    expect(typeof json.version).toBe("number");
    expect(Array.isArray(json.flags)).toBe(true);
  });

  it("a stale X-Data-Version after a new flag returns changed+flags; the fresh version that follows returns changed:false with no flags array", async () => {
    const before = ((await (await GET(context())).json()) as any).version as number;

    await markAiPageSourceWrite("pages/route-test/page.tsx", {});

    const stale = (await (await GET(context(before))).json()) as any;
    expect(stale.changed).toBe(true);
    expect(stale.version).toBeGreaterThan(before);
    expect(stale.flags.some((f: any) => f.path === "pages/route-test/page.tsx")).toBe(true);

    const fresh = (await (await GET(context(stale.version))).json()) as any;
    expect(fresh).toEqual({ changed: false, version: stale.version });
    expect(fresh.flags).toBeUndefined();
  });

  it("401s with no session", async () => {
    const anon = await GET({ ...context(), session: null });
    expect(anon.status).toBe(401);
  });
});
