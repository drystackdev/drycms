import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-ai-magic-write-fetch-"));
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    storage: { kind: "local", root: join(tempDirBox.path, "storage") },
  };
});

const { executeMagicFetch } = await import("./ai-magic-write-fetch.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content, storage } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

const schema = createContentEngineAdapter(content);
const entries = createContentEntryEngineAdapter(content);

let superAdminSession: SessionPayload;
let noPermissionSession: SessionPayload;
let categoryType: ContentTypeDefinition;
let postType: ContentTypeDefinition;

beforeAll(async () => {
  const allTypesBefore = await schema.listContentTypes();
  const userType = allTypesBefore.find((t) => t.name === "user")!;
  const roleType = allTypesBefore.find((t) => t.name === "role")!;

  const adminRole = await entries.createEntry(roleType, allTypesBefore, {
    name: "Fetch Test Super Admin",
    description: "",
    isSuperAdmin: true,
    permissions: [],
  });
  const adminUser = await entries.createEntry(userType, allTypesBefore, {
    name: "Fetch Test Admin",
    email: "fetch-test-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [adminRole.id],
  });
  superAdminSession = { id: adminUser.id, name: "Fetch Test Admin", email: "fetch-test-admin@example.com" };

  const noPermRole = await entries.createEntry(roleType, allTypesBefore, {
    name: "No Permissions",
    description: "",
    isSuperAdmin: false,
    permissions: [],
  });
  const noPermUser = await entries.createEntry(userType, allTypesBefore, {
    name: "No Permissions User",
    email: "no-perm-user@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [noPermRole.id],
  });
  noPermissionSession = { id: noPermUser.id, name: "No Permissions User", email: "no-perm-user@example.com" };

  categoryType = {
    id: "custom-fetch-category",
    kind: "collection",
    name: "fetchcategory",
    label: "Category",
    features: {},
    fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(categoryType, await schema.planSave(categoryType));

  postType = {
    id: "custom-fetch-post",
    kind: "collection",
    name: "fetchpost",
    label: "Post",
    features: {},
    fields: [
      { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
      { id: "f-secret", name: "apiKey", label: "API Key", type: "secretkey", config: {}, validation: {}, order: 1 },
      {
        id: "f-category",
        name: "category",
        label: "Category",
        type: "relation",
        config: { targetTypeId: categoryType.id, cardinality: "manyToOne" },
        validation: {},
        order: 2,
      },
    ],
    version: 0,
  };
  await schema.applySave(postType, await schema.planSave(postType));

  const catA = await entries.createEntry(categoryType, [categoryType], { name: "Travel" });
  const catB = await entries.createEntry(categoryType, [categoryType], { name: "Cooking" });
  await entries.createEntry(postType, [categoryType, postType], { title: "Mountain trip", apiKey: "super-secret-value", category: catA.id });
  await entries.createEntry(postType, [categoryType, postType], { title: "Pasta recipe", apiKey: "another-secret", category: catB.id });
});

function context(session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/ai/magic-write");
  return { params: {}, request: new Request(url), url, env: {}, session };
}

describe("executeMagicFetch - source: types", () => {
  it("lists every non-component content type by name and label", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "types" });
    expect(result.resultText).toContain('fetchcategory (label: "Category", collection)');
    expect(result.resultText).toContain('fetchpost (label: "Post", collection)');
    expect(result.seenEntryIds).toBeUndefined();
  });
});

describe("executeMagicFetch - source: entries", () => {
  it("lists rows for a real type and reports their ids as seenEntryIds", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "entries", typeSlug: "fetchcategory" });
    expect(result.resultText).toContain("Travel");
    expect(result.resultText).toContain("Cooking");
    expect(result.seenEntryIds?.targetTypeId).toBe(categoryType.id);
    expect(result.seenEntryIds?.ids.length).toBe(2);
  });

  it("never includes a secretkey field's real value - only the masked marker is skipped entirely", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "entries", typeSlug: "fetchpost" });
    expect(result.resultText).not.toContain("super-secret-value");
    expect(result.resultText).not.toContain("another-secret");
    expect(result.resultText).not.toContain("apiKey");
    expect(result.resultText).toContain("Mountain trip");
  });

  it("filters by search against the type's own text fields", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "entries", typeSlug: "fetchpost", search: "Mountain" });
    expect(result.resultText).toContain("Mountain trip");
    expect(result.resultText).not.toContain("Pasta recipe");
  });

  it("reports an unknown type by name instead of throwing", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "entries", typeSlug: "does-not-exist" });
    expect(result.resultText).toContain('No content type named "does-not-exist" exists');
    expect(result.seenEntryIds).toBeUndefined();
  });

  it("denies a session with no view permission on that type, without leaking any row data", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(noPermissionSession), entries, allTypes, storage, { kind: "fetch", source: "entries", typeSlug: "fetchpost" });
    expect(result.resultText).toContain("don't have permission");
    expect(result.resultText).not.toContain("Mountain trip");
    expect(result.seenEntryIds).toBeUndefined();
  });
});

describe("executeMagicFetch - source: entry", () => {
  it("fetches one row by id and reports it as seenEntryIds", async () => {
    const allTypes = await schema.listContentTypes();
    const list = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "entries", typeSlug: "fetchcategory" });
    const id = list.seenEntryIds!.ids[0]!;
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "entry", typeSlug: "fetchcategory", id: String(id) });
    expect(result.seenEntryIds).toEqual({ targetTypeId: categoryType.id, ids: [id] });
  });

  it("reports a missing id instead of throwing", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "entry", typeSlug: "fetchcategory", id: "999999" });
    expect(result.resultText).toContain("No");
    expect(result.seenEntryIds).toBeUndefined();
  });
});

describe("executeMagicFetch - source: media", () => {
  it("reports an empty root without throwing", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicFetch(context(), entries, allTypes, storage, { kind: "fetch", source: "media" });
    expect(result.resultText).toContain("empty");
  });
});
