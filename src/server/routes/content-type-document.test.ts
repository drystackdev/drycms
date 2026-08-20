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
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-content-type-document-route-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") },
    typesCacheStorage: resolved.typesCache.storage,
  };
});

const { GET, PUT, POST } = await import("./content-type-document.js");
const { POST: contentTypesPOST } = await import("./content-types.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { createStorageSchemaDocumentStore } = await import("../schema-document-storage.js");
const { content } = await import("../config.js");

const docStore = () => createStorageSchemaDocumentStore({ env: {} });

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

/** Schema writes require Super Admin (`content-types/access.ts`), so the
 * suite seeds one real account and reuses its session - same bootstrap
 * `content-types.test.ts` does. */
let superAdminSession: SessionPayload;

beforeAll(async () => {
  const schema = createContentEngineAdapter(content, undefined, docStore());
  const entries = createContentEntryEngineAdapter(content);
  const allTypes = await schema.listContentTypes();
  const role = await entries.createEntry(allTypes.find((t) => t.name === "role")!, allTypes, {
    name: "Test Super Admin",
    description: "",
    isSuperAdmin: true,
    permissions: [],
  });
  const user = await entries.createEntry(allTypes.find((t) => t.name === "user")!, allTypes, {
    name: "Test Admin",
    email: "drafts-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "drafts-admin@example.com" };
});

function context(method: string, body?: unknown, session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/content-type-document");
  const request = new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
  return { params: {}, request, url, env: {}, session };
}

function slugContext(slug: string, method: string, rawBody?: string): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/content-type-document/${slug}`);
  const request = new Request(url, {
    method,
    body: rawBody,
    headers: rawBody === undefined ? {} : { "content-type": "application/json" },
  });
  return { params: { slug }, request, url, env: {}, session: superAdminSession };
}

function draftType(id: string, name: string): ContentTypeDefinition {
  return { id, kind: "collection", name, label: name, fields: [], version: 0 } as ContentTypeDefinition;
}

describe("content-type drafts (the staging half of content/types.json)", () => {
  it("round-trips a staged draft through the document, and refuses an anonymous caller", async () => {
    expect((await GET(context("GET", undefined, null))).status).toBe(401);

    const saved = await PUT(context("PUT", { drafts: [{ definition: draftType("draft-post", "post"), isNew: true, source: "local" }] }));
    expect(saved.status).toBe(200);

    const listed = (await (await GET(context("GET"))).json()) as { drafts: { definition: ContentTypeDefinition; isNew: boolean }[] };
    expect(listed.drafts).toHaveLength(1);
    expect(listed.drafts[0]!.definition.name).toBe("post");
    expect(listed.drafts[0]!.isNew).toBe(true);

    // The staged draft is in the real file, next to the applied schema.
    const document = await docStore().read();
    expect(document?.drafts.map((draft) => draft.definition.id)).toEqual(["draft-post"]);
    expect(document?.applied.some((type) => type.id === "draft-post")).toBe(false);
  });

  it("rejects a malformed payload rather than clearing the staging area", async () => {
    expect((await PUT(context("PUT", { drafts: "nope" }))).status).toBe(400);
    expect((await PUT(context("PUT", { drafts: [{ isNew: true }] }))).status).toBe(400);
    expect((await docStore().read())?.drafts).toHaveLength(1);
  });

  it("clears a draft from the document once its type is applied", async () => {
    const applyUrl = new URL("http://localhost/dry/api/content-types/");
    const response = await contentTypesPOST({
      params: {},
      url: applyUrl,
      env: {},
      session: superAdminSession,
      request: new Request(applyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "apply", drafts: [{ definition: draftType("draft-post", "post"), isNew: true }] }),
      }),
    } as DryRouteContext);
    const body = (await response.json()) as { results: { ok: boolean }[]; git?: { committed: boolean; reason?: string } };
    expect(body.results.every((result) => result.ok)).toBe(true);
    // No git repo is configured in this suite, so the commit half reports
    // itself as skipped instead of failing the apply.
    expect(body.git?.committed).toBe(false);

    const document = await docStore().read();
    expect(document?.applied.find((type) => type.id === "draft-post")?.version).toBe(1);
    expect(document?.drafts).toEqual([]);
  });
});

describe("export / import", () => {
  it("exports the whole document as a downloadable JSON file", async () => {
    const response = await GET(slugContext("export", "GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="drycms-content-types-.*\.json"/);
    const parsed = JSON.parse(await response.text()) as { applied: ContentTypeDefinition[] };
    expect(parsed.applied.map((type) => type.name)).toContain("user");
  });

  it("stages an imported file as drafts instead of migrating anything", async () => {
    const before = await docStore().read();
    const live = before!.applied.find((type) => type.name === "menu")!;
    const file = JSON.stringify({
      format: 1,
      revision: 999,
      applied: [
        // Brand new here.
        { id: "imported-post", kind: "collection", name: "post", label: "Post", fields: [], version: 7 },
        // Already live, changed label - and carrying a version from the
        // project it was exported from, which must be ignored.
        { ...live, label: "Main menu", version: 42 },
        // Already live, byte-identical apart from `version`.
        { ...before!.applied.find((type) => type.name === "user")!, version: 99 },
      ],
      drafts: [],
    });

    const response = await POST(slugContext("import", "POST", file));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { added: string[]; updated: string[]; unchanged: string[] };
    expect(body.added).toEqual(["post"]);
    expect(body.updated).toEqual(["menu"]);
    expect(body.unchanged).toEqual(["user"]);

    const after = await docStore().read();
    const postDraft = after!.drafts.find((draft) => draft.definition.id === "imported-post");
    expect(postDraft?.isNew).toBe(true);
    expect(postDraft?.definition.version).toBe(0);
    // The live type's own optimistic-lock version wins over the file's, so
    // "Apply and build" doesn't reject it as a stale edit.
    const menuDraft = after!.drafts.find((draft) => draft.definition.id === live.id);
    expect(menuDraft?.definition.version).toBe(live.version);
    expect(menuDraft?.isNew).toBe(false);
    // Nothing was applied: the live schema is untouched.
    expect(after!.applied.find((type) => type.name === "menu")?.label).toBe(live.label);
  });

  it("accepts a bare definition array, and rejects a file it can't read", async () => {
    const bare = JSON.stringify([{ id: "imported-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 }]);
    expect((await POST(slugContext("import", "POST", bare))).status).toBe(200);
    expect((await docStore().read())!.drafts.some((draft) => draft.definition.id === "imported-note")).toBe(true);

    expect((await POST(slugContext("import", "POST", "{ not json"))).status).toBe(400);
    expect((await POST(slugContext("import", "POST", "[]"))).status).toBe(400);
    expect((await POST(slugContext("nope", "POST", bare))).status).toBe(404);
  });
});
