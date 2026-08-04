import type { DryRouteContext } from "../context.js";
import { afterAll, describe, expect, it, vi } from "vitest";

const box = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  box.path = mkdtempSync(join(tmpdir(), "drycms-page-components-route-"));
  return { pageComponentsStorage: { kind: "local", root: box.path } };
});

const { GET, POST, PUT, PATCH, DELETE } = await import("./page-components.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(box.path, { recursive: true, force: true });
});

function context(opts: {
  slug?: string;
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/page-components/${opts.slug ?? ""}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) url.searchParams.set(key, value);
  const request = new Request(url, {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: opts.headers,
  });
  return { params: { slug: opts.slug }, request, url, env: {}, session: null };
}

function jsonBody(body: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

const SAMPLE_SOURCE = "export default function () {\n  return <div></div>;\n}\n";

describe("GET /dry/api/page-components/[...slug]", () => {
  it("?tree on an empty root reports supported with no entries", async () => {
    const response = await GET(context({ slug: "", query: { tree: "" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ supported: true, entries: [] });
  });

  it("lists an empty root as a folder listing", async () => {
    const response = await GET(context({ slug: "" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "", entries: [] });
  });

  it("404s for a missing file", async () => {
    const response = await GET(context({ slug: "Missing.tsx" }));
    expect(response.status).toBe(404);
  });
});

describe("PUT /dry/api/page-components/[...slug]", () => {
  it("creates a new .tsx component and GET reads it back as raw text", async () => {
    const put = await PUT(context({ slug: "Button.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    expect(put.status).toBe(200);
    const created = (await put.json()).entry;
    expect(created.name).toBe("Button.tsx");
    expect(created.kind).toBe("file");

    const get = await GET(context({ slug: "Button.tsx" }));
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(SAMPLE_SOURCE);
  });

  it("overwrites an existing file's content", async () => {
    await PUT(context({ slug: "Overwrite.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const updated = "export default function () { return <span />; }\n";
    const put = await PUT(context({ slug: "Overwrite.tsx", method: "PUT", body: updated }));
    expect(put.status).toBe(200);
    const get = await GET(context({ slug: "Overwrite.tsx" }));
    expect(await get.text()).toBe(updated);
  });

  it("auto-creates missing parent folders for a nested path", async () => {
    const put = await PUT(context({ slug: "layout/Header.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    expect(put.status).toBe(200);
    const listing = await GET(context({ slug: "layout" }));
    expect(listing.status).toBe(200);
    const body = (await listing.json()) as { entries: { name: string }[] };
    expect(body.entries.map((entry) => entry.name)).toEqual(["Header.tsx"]);
  });

  it("rejects a non-.tsx/.ts file name", async () => {
    const put = await PUT(context({ slug: "Button.jsx", method: "PUT", body: SAMPLE_SOURCE }));
    expect(put.status).toBe(400);
    const body = await put.json();
    expect(body.error).toBe("invalid_path");
  });
});

describe("POST /dry/api/page-components/[...slug] (mkdir)", () => {
  it("creates an empty folder", async () => {
    const response = await POST(context({ slug: "", method: "POST", ...jsonBody({ action: "mkdir", name: "widgets" }) }));
    expect(response.status).toBe(201);
    const entry = (await response.json()).entry;
    expect(entry.kind).toBe("folder");
    expect(entry.name).toBe("widgets");
  });

  it("rejects an unsupported action", async () => {
    const response = await POST(context({ slug: "", method: "POST", ...jsonBody({ action: "nope" }) }));
    expect(response.status).toBe(400);
  });
});

describe("PATCH /dry/api/page-components/[...slug] (move)", () => {
  it("renames a component file", async () => {
    await PUT(context({ slug: "Old.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const response = await PATCH(context({ slug: "Old.tsx", method: "PATCH", ...jsonBody({ action: "move", to: "New.tsx" }) }));
    expect(response.status).toBe(200);
    expect((await GET(context({ slug: "Old.tsx" }))).status).toBe(404);
    expect((await GET(context({ slug: "New.tsx" }))).status).toBe(200);
  });

  it("rejects renaming a file to a non-component extension", async () => {
    await PUT(context({ slug: "Renameable.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const response = await PATCH(context({ slug: "Renameable.tsx", method: "PATCH", ...jsonBody({ action: "move", to: "Renameable.txt" }) }));
    expect(response.status).toBe(400);
  });
});

describe("DELETE /dry/api/page-components/[...slug]", () => {
  it("removes a component file", async () => {
    await PUT(context({ slug: "Deletable.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const response = await DELETE(context({ slug: "Deletable.tsx", method: "DELETE" }));
    expect(response.status).toBe(204);
    expect((await GET(context({ slug: "Deletable.tsx" }))).status).toBe(404);
  });

  it("400s deleting the root", async () => {
    const response = await DELETE(context({ slug: "", method: "DELETE" }));
    expect(response.status).toBe(400);
  });
});
