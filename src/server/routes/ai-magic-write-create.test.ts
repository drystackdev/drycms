import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-ai-magic-write-create-"));
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    // The schema itself lives in `content/types.json` under page-source
    // storage now (`schema-document.ts`), not in a `metadata` table.
    pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") },
    storage: { kind: "local", root: join(tempDirBox.path, "storage") },
  };
});

const { executeMagicCreate } = await import("./ai-magic-write-create.js");
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

const schema = createContentEngineAdapter(content, undefined, docStore());
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
    name: "Create Test Super Admin",
    description: "",
    isSuperAdmin: true,
    permissions: [],
  });
  const adminUser = await entries.createEntry(userType, allTypesBefore, {
    name: "Create Test Admin",
    email: "create-test-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [adminRole.id],
  });
  superAdminSession = { id: adminUser.id, name: "Create Test Admin", email: "create-test-admin@example.com" };

  const noPermRole = await entries.createEntry(roleType, allTypesBefore, {
    name: "No Permissions (create test)",
    description: "",
    isSuperAdmin: false,
    permissions: [],
  });
  const noPermUser = await entries.createEntry(userType, allTypesBefore, {
    name: "No Permissions User (create test)",
    email: "no-perm-create-test@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [noPermRole.id],
  });
  noPermissionSession = { id: noPermUser.id, name: "No Permissions User", email: "no-perm-create-test@example.com" };

  categoryType = {
    id: "custom-create-category",
    kind: "collection",
    name: "createcategory",
    label: "Category",
    features: {},
    fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(categoryType, await schema.planSave(categoryType));

  postType = {
    id: "custom-create-post",
    kind: "collection",
    name: "createpost",
    label: "Post",
    features: {},
    fields: [
      { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
      {
        id: "f-category",
        name: "category",
        label: "Category",
        type: "relation",
        config: { targetTypeId: categoryType.id, cardinality: "manyToOne" },
        validation: {},
        order: 1,
      },
    ],
    version: 0,
  };
  await schema.applySave(postType, await schema.planSave(postType));
});

function context(session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/ai/magic-write");
  return { params: {}, request: new Request(url), url, env: {}, session };
}

describe("executeMagicCreate", () => {
  it("creates a new entry and reports it as createdEntryId", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicCreate(context(), entries, allTypes, new Set(["createcategory"]), {
      kind: "create",
      typeSlug: "createcategory",
      fields: { name: "Adventure" },
    });
    expect(result.createdEntryId?.targetTypeId).toBe(categoryType.id);
    expect(result.resultText).toContain(`#${result.createdEntryId!.id}`);
    const created = await entries.getEntry(categoryType, allTypes, result.createdEntryId!.id);
    expect(created?.value.name).toBe("Adventure");
  });

  it("rejects a typeSlug outside the caller's creatableTypeSlugs scope, even for a super admin", async () => {
    const allTypes = await schema.listContentTypes();
    // "createpost" is a real, permission-accessible type - only NOT in the
    // scope set passed in, mirroring an entry whose own schema has no
    // relation field pointing at it.
    const result = await executeMagicCreate(context(), entries, allTypes, new Set(["createcategory"]), {
      kind: "create",
      typeSlug: "createpost",
      fields: { title: "Should not be created" },
    });
    expect(result.resultText).toContain("directly related");
    expect(result.createdEntryId).toBeUndefined();
    const list = await entries.listEntries(postType, allTypes, { page: 0, pageSize: 10 });
    expect(list.total).toBe(0);
  });

  it("reports an unknown type by name instead of throwing", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicCreate(context(), entries, allTypes, new Set(["does-not-exist"]), {
      kind: "create",
      typeSlug: "does-not-exist",
      fields: { name: "x" },
    });
    expect(result.resultText).toContain('No content type named "does-not-exist" exists');
    expect(result.createdEntryId).toBeUndefined();
  });

  it("denies a session with no magic/create permission on the target type, without creating anything", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicCreate(context(noPermissionSession), entries, allTypes, new Set(["createcategory"]), {
      kind: "create",
      typeSlug: "createcategory",
      fields: { name: "Should not be created" },
    });
    expect(result.resultText).toContain("don't have permission");
    expect(result.createdEntryId).toBeUndefined();
  });

  it("drops a relation field on the newly created row - only plain scalars land", async () => {
    const allTypes = await schema.listContentTypes();
    const category = await entries.createEntry(categoryType, allTypes, { name: "Existing" });
    const result = await executeMagicCreate(context(), entries, allTypes, new Set(["createpost"]), {
      kind: "create",
      typeSlug: "createpost",
      fields: { title: "New Post", category: String(category.id) },
    });
    expect(result.createdEntryId).toBeDefined();
    const created = await entries.getEntry(postType, allTypes, result.createdEntryId!.id);
    expect(created?.value.title).toBe("New Post");
    expect(created?.value.category).toBeNull();
  });

  it("reports rather than throws when no usable fields were given", async () => {
    const allTypes = await schema.listContentTypes();
    const result = await executeMagicCreate(context(), entries, allTypes, new Set(["createcategory"]), {
      kind: "create",
      typeSlug: "createcategory",
      fields: {},
    });
    expect(result.resultText).toContain("nothing was created");
    expect(result.createdEntryId).toBeUndefined();
  });
});
