import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-mcp-activity-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") }, pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") }, typesCacheStorage: resolved.typesCache.storage };
});

const { POST, GET, listMcpActivity } = await import("./mcp.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { createStorageSchemaDocumentStore } = await import("../schema-document-storage.js");
/** The engine adapters this file builds by hand must read and write the SAME
 * `content/types.json` the route handlers under test do - a default in-memory
 * document would make each side seed its own schema over the other's tables. */
const docStore = () => createStorageSchemaDocumentStore({ env: {} });
const { content } = await import("../config.js");

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
    email: "mcp-activity-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "mcp-activity-admin@example.com" };
});

function activityContext(ifVersion?: number): DryRouteContext {
  const url = new URL("http://localhost/dry/api/mcp/activity");
  const headers: Record<string, string> = {};
  if (ifVersion !== undefined) headers["X-Data-Version"] = String(ifVersion);
  const request = new Request(url, { method: "GET", headers });
  return { params: { slug: "activity" }, request, url, env: {}, session: superAdminSession };
}

/** Issues a real `tools/call` (`list_docs` - fast, no DB access) purely to
 * make `recordMcpActivity` (fire-and-forget, never awaited by the POST
 * handler itself) write a real entry, then polls the already-exported
 * `listMcpActivity` in a short bounded loop until at least `minCount`
 * entries are visible - the simplest way to deterministically exercise the
 * REAL recording path without reaching into its private KV internals. */
async function callToolAndWaitForActivity(minCount: number): Promise<void> {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_docs", arguments: {} } };
  const request = new Request("http://localhost/dry/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const context: DryRouteContext = { params: {}, request, url: new URL(request.url), env: {}, session: superAdminSession };
  await POST(context);

  for (let i = 0; i < 100; i++) {
    const activity = await listMcpActivity(superAdminSession.id, {});
    if (activity.length >= minCount) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("recordMcpActivity never landed within the test's wait budget.");
}

describe("GET /dry/api/mcp/activity - data-version protocol", () => {
  it("always includes version/changed:true on a first (unversioned) request, even with nothing logged yet for that user", async () => {
    const response = await GET(activityContext());
    const json = (await response.json()) as any;
    expect(json.changed).toBe(true);
    expect(typeof json.version).toBe("number");
    expect(json.activity).toEqual([]);
  });

  it("a stale X-Data-Version after a new tool call returns changed+activity; the fresh version that follows returns changed:false with no activity array", async () => {
    const before = ((await (await GET(activityContext())).json()) as any).version as number;

    await callToolAndWaitForActivity(1);

    const stale = (await (await GET(activityContext(before))).json()) as any;
    expect(stale.changed).toBe(true);
    expect(stale.version).toBeGreaterThan(before);
    expect(Array.isArray(stale.activity)).toBe(true);
    expect(stale.activity.length).toBeGreaterThan(0);
    expect(stale.activity[0].tool).toBe("list_docs");

    const fresh = (await (await GET(activityContext(stale.version))).json()) as any;
    expect(fresh).toEqual({ changed: false, version: stale.version });
    expect(fresh.activity).toBeUndefined();
  });

  it("a second tool call bumps the version again, invalidating the previously-fresh one", async () => {
    const before = ((await (await GET(activityContext())).json()) as any).version as number;
    const countBefore = (await listMcpActivity(superAdminSession.id, {})).length;

    await callToolAndWaitForActivity(countBefore + 1);

    const after = (await (await GET(activityContext(before))).json()) as any;
    expect(after.changed).toBe(true);
    expect(after.version).toBeGreaterThan(before);
  });
});
