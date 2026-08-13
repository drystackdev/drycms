import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ contentDir: "", pagesSourceDir: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.contentDir = mkdtempSync(join(tmpdir(), "drycms-mcp-write-page-source-content-"));
  tempDirBox.pagesSourceDir = mkdtempSync(join(tmpdir(), "drycms-mcp-write-page-source-pages-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.contentDir });
  return {
    content: { engine: "sqlite", file: join(tempDirBox.contentDir, "content.sqlite") },
    typesCacheStorage: resolved.typesCache.storage,
    pagesSourceStorage: { kind: "local", root: tempDirBox.pagesSourceDir },
  };
});

const { POST } = await import("./mcp.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");
const { listAiPageSourceFlags } = await import("../ai-page-source-flags.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.contentDir, { recursive: true, force: true });
  await rm(tempDirBox.pagesSourceDir, { recursive: true, force: true });
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
    email: "mcp-write-page-source-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "mcp-write-page-source-admin@example.com" };
});

async function writePageSource(filePath: string, code: string): Promise<{ text: string; isError: boolean }> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "write_page_source", arguments: { path: filePath, code } },
  };
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

describe("write_page_source - ai-page-source-flags tracking", () => {
  it("flags a page.tsx write so PageEditor's red dot can pick it up", async () => {
    const { isError } = await writePageSource("pages/hello/page.tsx", "export default function Page() { return null; }");
    expect(isError).toBe(false);

    const flags = await listAiPageSourceFlags({});
    expect(flags.some((f) => f.path === "pages/hello/page.tsx")).toBe(true);
  });

  it("does NOT flag a non-page.tsx write (layout/component) - only route-entry files are tracked, matching PageEditor's own needsBuild scope", async () => {
    await writePageSource("pages/hello/layout.tsx", "export default function Layout({ children }) { return children; }");
    await writePageSource("component/Card.tsx", "export default function Card() { return null; }");

    const flags = await listAiPageSourceFlags({});
    expect(flags.some((f) => f.path === "pages/hello/layout.tsx")).toBe(false);
    expect(flags.some((f) => f.path === "component/Card.tsx")).toBe(false);
  });

  it("re-writing an already-flagged path refreshes it rather than duplicating the entry", async () => {
    await writePageSource("pages/repeat/page.tsx", "export default function Page() { return null; }");
    await writePageSource("pages/repeat/page.tsx", "export default function Page() { return 1; }");

    const flags = await listAiPageSourceFlags({});
    expect(flags.filter((f) => f.path === "pages/repeat/page.tsx")).toHaveLength(1);
  });
});
