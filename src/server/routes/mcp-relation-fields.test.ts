import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("../options.js");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-mcp-relation-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") }, pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") }, typesCacheStorage: resolved.typesCache.storage, path: resolved.path };
});

const { POST } = await import("./mcp.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { createStorageSchemaDocumentStore } = await import("../schema-document-storage.js");
/** The engine adapters this file builds by hand must read and write the SAME
 * `content/types.json` the route handlers under test do - a default in-memory
 * document would make each side seed its own schema over the other's tables. */
const docStore = () => createStorageSchemaDocumentStore({ env: {} });
const { content } = await import("../config.js");
const { permissionKeyFor } = await import("../../content-types/permissions.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

const schema = createContentEngineAdapter(content, undefined, docStore());
const entries = createContentEntryEngineAdapter(content);

let superAdminSession: SessionPayload;
let noViewSession: SessionPayload;
let categoryType: ContentTypeDefinition;
let postType: ContentTypeDefinition;
let catA: { id: number };
let catB: { id: number };

beforeAll(async () => {
  const allTypesBefore = await schema.listContentTypes();
  const userType = allTypesBefore.find((t) => t.name === "user")!;
  const roleType = allTypesBefore.find((t) => t.name === "role")!;

  const adminRole = await entries.createEntry(roleType, allTypesBefore, {
    name: "Relation Test Super Admin",
    description: "",
    isSuperAdmin: true,
    permissions: [],
  });
  const adminUser = await entries.createEntry(userType, allTypesBefore, {
    name: "Relation Test Admin",
    email: "mcp-relation-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [adminRole.id],
  });
  superAdminSession = { id: adminUser.id, name: "Relation Test Admin", email: "mcp-relation-admin@example.com" };

  categoryType = {
    id: "custom-relation-category",
    kind: "collection",
    name: "relationcategory",
    label: "Category",
    features: {},
    fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(categoryType, await schema.planSave(categoryType));

  postType = {
    id: "custom-relation-post",
    kind: "collection",
    name: "relationpost",
    label: "Post",
    features: {},
    fields: [
      { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
      {
        id: "f-category",
        name: "category",
        label: "Category",
        type: "relation",
        config: { target: categoryType.id, cardinality: "manyToOne" },
        validation: {},
        order: 1,
      },
      {
        id: "f-tags",
        name: "tags",
        label: "Tags",
        type: "relation",
        config: { target: categoryType.id, cardinality: "manyToMany" },
        validation: {},
        order: 2,
      },
    ],
    version: 0,
  };
  await schema.applySave(postType, await schema.planSave(postType));

  catA = await entries.createEntry(categoryType, [categoryType], { name: "Travel" });
  catB = await entries.createEntry(categoryType, [categoryType], { name: "Cooking" });

  // Can create/update relationpost entries, but has no permission on
  // relationcategory at all - used to prove a relation write is gated on
  // access to the TARGET collection, not just the entry being written.
  const limitedRole = await entries.createEntry(roleType, allTypesBefore, {
    name: "Relation Test Limited",
    description: "",
    isSuperAdmin: false,
    permissions: [
      permissionKeyFor(postType.id, "create"),
      permissionKeyFor(postType.id, "update"),
      permissionKeyFor(postType.id, "magic"),
    ],
  });
  const limitedUser = await entries.createEntry(userType, allTypesBefore, {
    name: "Relation Test Limited User",
    email: "mcp-relation-limited@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [limitedRole.id],
  });
  noViewSession = { id: limitedUser.id, name: "Relation Test Limited User", email: "mcp-relation-limited@example.com" };
});

async function callTool(name: string, args: Record<string, unknown>, session: SessionPayload): Promise<{ text: string; isError: boolean }> {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const request = new Request("http://localhost/dry/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const context: DryRouteContext = { params: {}, request, url: new URL(request.url), env: {}, session };
  const response = await POST(context);
  const json = (await response.json()) as any;
  const item = json.result.content[0];
  return { text: item.text as string, isError: json.result.isError === true };
}

describe("create_entry - relation fields", () => {
  it("links a manyToOne relation field given the target's real numeric id", async () => {
    const result = await callTool("create_entry", { typeSlug: "relationpost", fields: { title: "Hello", category: catA.id } }, superAdminSession);
    expect(result.isError).toBe(false);
    expect(result.text).toContain("category");
    const id = Number(result.text.match(/#(\d+)/)?.[1]);
    const row = await entries.getEntry(postType, [categoryType, postType], id);
    expect(row?.value.category).toBe(catA.id);
  });

  it("links a manyToMany relation field given a JSON array of real ids", async () => {
    const result = await callTool("create_entry", { typeSlug: "relationpost", fields: { title: "Multi", tags: [catA.id, catB.id] } }, superAdminSession);
    expect(result.isError).toBe(false);
    const id = Number(result.text.match(/#(\d+)/)?.[1]);
    const row = await entries.getEntry(postType, [categoryType, postType], id);
    expect(row?.value.tags).toEqual(expect.arrayContaining([catA.id, catB.id]));
  });

  it("also accepts a comma-separated string for a multi-valued relation field", async () => {
    const result = await callTool("create_entry", { typeSlug: "relationpost", fields: { title: "Comma", tags: `${catA.id},${catB.id}` } }, superAdminSession);
    expect(result.isError).toBe(false);
    const id = Number(result.text.match(/#(\d+)/)?.[1]);
    const row = await entries.getEntry(postType, [categoryType, postType], id);
    expect(row?.value.tags).toEqual(expect.arrayContaining([catA.id, catB.id]));
  });

  it("silently drops a relation id that doesn't exist in the target collection, keeping the rest of the write", async () => {
    const result = await callTool("create_entry", { typeSlug: "relationpost", fields: { title: "Dangling ref", category: 999999 } }, superAdminSession);
    expect(result.isError).toBe(false);
    expect(result.text).not.toContain("category");
    const id = Number(result.text.match(/#(\d+)/)?.[1]);
    const row = await entries.getEntry(postType, [categoryType, postType], id);
    expect(row?.value.category).toBeFalsy();
  });

  it("errors with a message that no longer claims relation fields are unsupported", async () => {
    const result = await callTool("create_entry", { typeSlug: "relationpost", fields: { category: 999999 } }, superAdminSession);
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain("Relation/image fields aren't supported");
    expect(result.text).toContain("Image fields aren't supported");
  });

  it("drops a relation write to a target collection the caller has no view access to, even though the id is real", async () => {
    const result = await callTool("create_entry", { typeSlug: "relationpost", fields: { title: "No view access", category: catA.id } }, noViewSession);
    expect(result.isError).toBe(false);
    expect(result.text).not.toContain("category");
    const id = Number(result.text.match(/#(\d+)/)?.[1]);
    const row = await entries.getEntry(postType, [categoryType, postType], id);
    expect(row?.value.category).toBeFalsy();
  });
});

describe("update_entry_fields - relation fields", () => {
  it("re-links an existing entry's manyToOne relation field to a different real id", async () => {
    const created = await entries.createEntry(postType, [categoryType, postType], { title: "To update", category: catA.id });
    const result = await callTool("update_entry_fields", { typeSlug: "relationpost", id: String(created.id), fields: { category: catB.id } }, superAdminSession);
    expect(result.isError).toBe(false);
    const row = await entries.getEntry(postType, [categoryType, postType], created.id);
    expect(row?.value.category).toBe(catB.id);
  });
});
