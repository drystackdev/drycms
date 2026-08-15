import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-mcp-list-refresh-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    typesCacheStorage: resolved.typesCache.storage,
    storage: resolved.storage,
    path: resolved.path,
  };
});

const { POST } = await import("./mcp.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");
const { writeGeneratedDryTypes } = await import("../../content-types/types-cache.js");

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
    name: "List Refresh Test Super Admin",
    description: "",
    isSuperAdmin: true,
    permissions: [],
  });
  const user = await entries.createEntry(userType, allTypes, {
    name: "List Refresh Test Admin",
    email: "mcp-list-refresh-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "List Refresh Test Admin", email: "mcp-list-refresh-admin@example.com" };

  // A newly created collection the stale cache below deliberately doesn't
  // know about yet.
  const freshType = {
    id: "custom-list-refresh-type",
    kind: "collection" as const,
    name: "listrefreshtype",
    label: "List Refresh Type",
    features: {},
    fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(freshType, await schema.planSave(freshType));
});

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const request = new Request("http://localhost/dry/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const context: DryRouteContext = { params: {}, request, url: new URL(request.url), env: {}, session: superAdminSession };
  const response = await POST(context);
  const json = (await response.json()) as any;
  const item = json.result.content[0];
  return { text: item.text as string, isError: json.result.isError === true };
}

function context(): DryRouteContext {
  const url = new URL("http://localhost/dry/api/mcp");
  return { params: {}, request: new Request(url), url, env: {}, session: superAdminSession };
}

describe("list_content_types - eager dry.generated.d.ts refresh", () => {
  it("regenerates the stale types cache as a side effect, so a later read_dry_types call already sees the new type", async () => {
    // Simulate a cache left behind by an earlier schema state (or a run
    // that never wrote one at all) - deliberately missing the collection
    // created in beforeAll.
    await writeGeneratedDryTypes("declare const marker: 'stale-before-list';", context());

    const readBefore = await callTool("read_dry_types");
    expect(readBefore.text).toBe("declare const marker: 'stale-before-list';");

    const listResult = await callTool("list_content_types");
    expect(listResult.isError).toBe(false);
    expect(listResult.text).toContain("listrefreshtype");

    const readAfter = await callTool("read_dry_types");
    expect(readAfter.text).not.toBe("declare const marker: 'stale-before-list';");
    expect(readAfter.text).toContain("listrefreshtype");
  });
});
