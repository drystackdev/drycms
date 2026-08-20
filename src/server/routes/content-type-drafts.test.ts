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
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-content-type-drafts-route-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.path });
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") },
    typesCacheStorage: resolved.typesCache.storage,
  };
});

const { GET, PUT } = await import("./content-type-drafts.js");
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
  const url = new URL("http://localhost/dry/api/content-type-drafts");
  const request = new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
  return { params: {}, request, url, env: {}, session };
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
