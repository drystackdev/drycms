import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureHttpDryReader, dry } from "./dry-reader-http.js";
import { refOf } from "./dry-vei.js";
import type { DryVeiContext } from "./dry-context.js";
import type { ContentTypeDefinition } from "./types.js";
import { encodeCallLog } from "../server/app-router/dry-replay-codec.js";

function field(partial: Partial<ContentTypeDefinition["fields"][number]> & { id: string; name: string; type: string }): ContentTypeDefinition["fields"][number] {
  return { label: partial.name, config: {}, validation: {}, order: 0, ...partial };
}

const blog: ContentTypeDefinition = {
  id: "blog",
  kind: "collection",
  name: "blog",
  label: "Blog",
  version: 0,
  fields: [field({ id: "f1", name: "title", type: "text" }), field({ id: "f2", name: "summary", type: "text" })],
};

const siteSettings: ContentTypeDefinition = {
  id: "siteSettings",
  kind: "singleton",
  name: "siteSettings",
  label: "Site Settings",
  version: 0,
  fields: [field({ id: "s1", name: "title", type: "text" })],
};

const allTypes = [blog, siteSettings];

const alwaysCanUpdate: DryVeiContext = { canUpdate: () => true };
const neverCanUpdate: DryVeiContext = { canUpdate: () => false };

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json; charset=utf-8" };
}

describe("dry-reader-http.ts's markOrInert (real VEI boxing vs the build-time inert fallback)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("get() keeps today's inert $ when no vei context is configured (every real build/preview caller)", async () => {
    fetchMock.mockResolvedValue(
      new Response(encodeCallLog([{ kind: "collection", name: "blog", method: "get", result: { id: 7, title: "Xin chào" } }]), { headers: jsonHeaders() }),
    );
    configureHttpDryReader({ endpoint: "/dry/api/dry-http", callLog: [], deps: [], allTypes, seo: {} });

    const result = await dry().collection("blog").get(7);
    expect(refOf(result!.title)).toBeNull();
  });

  it("get() boxes real fields for real editing when a vei context says the type is updatable", async () => {
    fetchMock.mockResolvedValue(
      new Response(encodeCallLog([{ kind: "collection", name: "blog", method: "get", result: { id: 7, title: "Xin chào" } }]), { headers: jsonHeaders() }),
    );
    configureHttpDryReader({ endpoint: "/dry/api/dry-http", callLog: [], deps: [], allTypes, seo: {}, vei: alwaysCanUpdate });

    const result = await dry().collection("blog").get(7);
    expect(refOf(result!.title)).toEqual({ kind: "collection", type: "blog", id: 7, path: "title", fieldType: "text" });
  });

  it("get() stays inert when vei is present but canUpdate denies this type", async () => {
    fetchMock.mockResolvedValue(
      new Response(encodeCallLog([{ kind: "collection", name: "blog", method: "get", result: { id: 7, title: "Xin chào" } }]), { headers: jsonHeaders() }),
    );
    configureHttpDryReader({ endpoint: "/dry/api/dry-http", callLog: [], deps: [], allTypes, seo: {}, vei: neverCanUpdate });

    const result = await dry().collection("blog").get(7);
    expect(refOf(result!.title)).toBeNull();
  });

  it("list() boxes every row's fields the same way get() does, mirroring dry-reader.ts's own list() marking", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        encodeCallLog([
          {
            kind: "collection",
            name: "blog",
            method: "list",
            result: { rows: [{ id: 1, title: "A" }, { id: 2, title: "B" }], total: 2 },
          },
        ]),
        { headers: jsonHeaders() },
      ),
    );
    configureHttpDryReader({ endpoint: "/dry/api/dry-http", callLog: [], deps: [], allTypes, seo: {}, vei: alwaysCanUpdate });

    const { rows } = await dry().collection("blog").list();
    expect(rows.every((row) => refOf(row.title) !== null)).toBe(true);
  });

  it("list() leaves a select-transformed field unboxed even under a real vei session, matching dry-reader.ts's unboxedKeys contract", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        encodeCallLog([
          {
            kind: "collection",
            name: "blog",
            method: "list",
            result: { rows: [{ id: 1, title: "A", summary: "raw" }], total: 1 },
          },
        ]),
        { headers: jsonHeaders() },
      ),
    );
    configureHttpDryReader({ endpoint: "/dry/api/dry-http", callLog: [], deps: [], allTypes, seo: {}, vei: alwaysCanUpdate });

    const { rows } = await dry()
      .collection("blog")
      .list({ select: { title: true, summary: (value) => `${value}!` } });
    // `title` (plain `true` selection, no transform) still boxes; `summary`
    // (a real function transform) never does - `dry-reader.ts`'s own
    // `selectTransforms().keys` draws the identical line.
    expect(refOf(rows[0]!.title)).not.toBeNull();
    expect(refOf(rows[0]!.summary)).toBeNull();
    expect(rows[0]!.summary).toBe("raw!");
  });

  it("singleton get() marks the same way a collection get() does", async () => {
    fetchMock.mockResolvedValue(
      new Response(encodeCallLog([{ kind: "singleton", name: "siteSettings", method: "get", result: { id: 1, title: "Xin chào" } }]), { headers: jsonHeaders() }),
    );
    configureHttpDryReader({ endpoint: "/dry/api/dry-http", callLog: [], deps: [], allTypes, seo: {}, vei: alwaysCanUpdate });

    const result = await dry().singleton("siteSettings").get();
    expect(refOf(result!.title)).toEqual({ kind: "singleton", type: "siteSettings", id: 1, path: "title", fieldType: "text" });
  });
});
