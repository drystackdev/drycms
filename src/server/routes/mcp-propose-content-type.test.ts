import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContentTypeDefinition } from "../../content-types/types.js";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-mcp-propose-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") }, typesCacheStorage: resolved.typesCache.storage, path: resolved.path };
});

const { POST } = await import("./mcp.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");
const { listAiContentTypeDrafts } = await import("../ai-content-type-drafts.js");

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
    email: "mcp-propose-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "mcp-propose-admin@example.com" };
});

/** Issues one `tools/call` JSON-RPC request for `propose_content_type`. */
async function callTool(definition: unknown): Promise<{ text: string; isError: boolean }> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "propose_content_type", arguments: { definitionJson: JSON.stringify(definition) } },
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

async function pendingDraft(id: string): Promise<ContentTypeDefinition | undefined> {
  const drafts = await listAiContentTypeDrafts(superAdminSession.id, {});
  return drafts.find((d) => d.id === id)?.definition;
}

describe("propose_content_type - AI-friendly component field normalization", () => {
  it("rejects a component field with an unresolvable component reference, without saving a draft", async () => {
    const { text, isError } = await callTool({
      name: "badhost",
      label: "Bad Host",
      kind: "singleton",
      fields: [{ id: "hero", name: "hero", label: "Hero", type: "component", component: "doesNotExist" }],
    });
    expect(isError).toBe(true);
    expect(text).toContain('unknown component "doesNotExist"');
  });

  it("rejects an unknown field type with a clear message instead of saving a draft that would crash later", async () => {
    const { text, isError } = await callTool({
      name: "badtype",
      label: "Bad Type",
      kind: "collection",
      fields: [{ id: "f1", name: "f1", label: "F1", type: "not-a-real-type" }],
    });
    expect(isError).toBe(true);
    expect(text).toContain('unknown field type "not-a-real-type"');
  });

  it('accepts the exact malformed shape an AI produced in practice: component fields referenced by NAME (not id), no "config" wrapper, no "validation" on any field - repairs it into a well-formed draft instead of erroring', async () => {
    const archRow = await callTool({
      name: "archRow2",
      label: "Architecture Row",
      kind: "component",
      fields: [
        { id: "label", name: "label", label: "Label", type: "text" },
        { id: "value", name: "value", label: "Value", type: "text" },
      ],
    });
    expect(archRow.isError).toBe(false);
    const archRowId = archRow.text.match(/id "([^"]+)"/)?.[1];
    expect(archRowId).toBeTruthy();

    const statItem = await callTool({
      name: "statItem2",
      label: "Stat Item",
      kind: "component",
      fields: [{ id: "value", name: "value", label: "Value", type: "text" }],
    });
    expect(statItem.isError).toBe(false);

    // The dependent references BOTH siblings the way the AI actually did:
    // `archRow2` by bare "component" name string, `statItem2` by the SAME
    // name but this time nested under "config" with "multiple" instead of
    // "repeatable" - both aliases must resolve. No field here carries
    // "config"/"validation" at all except where shown.
    const homepage = await callTool({
      name: "homepage2",
      label: "Homepage",
      kind: "singleton",
      fields: [
        {
          id: "architecture",
          name: "architecture",
          label: "Architecture",
          type: "component",
          component: "archRow2",
          multiple: true,
        },
        {
          id: "stats",
          name: "stats",
          label: "Stats",
          type: "component",
          config: { component: "statItem2", multiple: true },
        },
        { id: "heroTitle", name: "heroTitle", label: "Hero Title", type: "text" },
      ],
    });
    expect(homepage.isError).toBe(false);
    const homepageId = homepage.text.match(/id "([^"]+)"/)?.[1];
    expect(homepageId).toBeTruthy();

    const saved = await pendingDraft(homepageId!);
    expect(saved).toBeTruthy();
    const architectureField = saved!.fields.find((f) => f.name === "architecture")!;
    const statsField = saved!.fields.find((f) => f.name === "stats")!;
    const heroField = saved!.fields.find((f) => f.name === "heroTitle")!;

    // Resolved to the REAL id, not left as the name string.
    expect((architectureField.config as any).componentId).toBe(archRowId);
    expect((architectureField.config as any).repeatable).toBe(true);
    expect((statsField.config as any).componentId).not.toBe("statItem2");
    expect((statsField.config as any).repeatable).toBe(true);

    // Every field - including the plain text one that never had
    // "validation" at all - got a well-formed (empty) validation object
    // rather than staying `undefined`.
    expect(heroField.validation).toEqual({});
    expect(architectureField.validation).toEqual({});
  });
});

describe("propose_content_type - existing field id resolution", () => {
  it("re-matches an unchanged/renamed-in-place field to its REAL live id by name, instead of minting a fresh one that would read as drop+add and lose data", async () => {
    const schema = createContentEngineAdapter(content);
    const live: ContentTypeDefinition = {
      id: "profile-live-id",
      kind: "collection",
      name: "profileidtest",
      label: "Profile Id Test",
      fields: [
        { id: "bio-real-id", name: "bio", label: "Bio", type: "text", config: {}, validation: {}, order: 0 },
      ],
      version: 0,
    };
    const plan = await schema.planSave(live, {});
    const saved = await schema.applySave(live, plan);
    expect(saved.id).toBe("profile-live-id");

    // The AI has no way to know "bio-real-id" - no MCP tool exposes it - so
    // a realistic re-proposal (adding a field, keeping "bio" as-is) omits
    // "id" on the field it isn't touching, exactly like the malformed-shape
    // test above omits ids the AI never had.
    const result = await callTool({
      name: "profileidtest",
      label: "Profile Id Test",
      kind: "collection",
      fields: [
        { name: "bio", label: "Bio", type: "text" },
        { name: "tagline", label: "Tagline", type: "text" },
      ],
    });
    expect(result.isError).toBe(false);
    const draftId = result.text.match(/id "([^"]+)"/)?.[1];
    expect(draftId).toBe("profile-live-id");

    const draft = await pendingDraft(draftId!);
    expect(draft).toBeTruthy();
    const bioField = draft!.fields.find((f) => f.name === "bio");
    expect(bioField?.id).toBe("bio-real-id");
    const taglineField = draft!.fields.find((f) => f.name === "tagline");
    expect(taglineField?.id).toBeTruthy();
    expect(taglineField?.id).not.toBe("bio-real-id");
  });
});
