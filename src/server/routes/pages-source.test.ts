import type { DryRouteContext } from "../context.js";
import { afterAll, describe, expect, it, vi } from "vitest";

const box = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  box.path = mkdtempSync(join(tmpdir(), "drycms-pages-source-route-"));
  return { pagesSourceStorage: { kind: "local", root: box.path } };
});

const { GET, POST, PUT, PATCH, DELETE } = await import("./pages-source.js");

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
  const url = new URL(`http://localhost/dry/api/pages-source/${opts.slug ?? ""}`);
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

const SAMPLE_SOURCE = "export default function Page() {\n  return <div></div>;\n}\n";

async function sourceHash(source: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("GET /dry/api/pages-source/[...slug]", () => {
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
    const response = await GET(context({ slug: "missing/page.tsx" }));
    expect(response.status).toBe(404);
  });
});

describe("PUT /dry/api/pages-source/[...slug]", () => {
  it("creates a new page.tsx and GET reads it back as raw text", async () => {
    const put = await PUT(context({ slug: "about/page.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    expect(put.status).toBe(200);
    const created = (await put.json()).entry;
    expect(created.name).toBe("page.tsx");
    expect(created.kind).toBe("file");

    const get = await GET(context({ slug: "about/page.tsx" }));
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(SAMPLE_SOURCE);
  });

  it("overwrites an existing file's content", async () => {
    await PUT(context({ slug: "overwrite/page.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const updated = "export default function Page() { return <span />; }\n";
    const put = await PUT(context({ slug: "overwrite/page.tsx", method: "PUT", body: updated }));
    expect(put.status).toBe(200);
    const get = await GET(context({ slug: "overwrite/page.tsx" }));
    expect(await get.text()).toBe(updated);
  });

  it("rejects an overwrite when storage moved beyond the editor's saved baseline", async () => {
    const slug = "conflict/page.tsx";
    await PUT(context({ slug, method: "PUT", body: SAMPLE_SOURCE }));
    const mcpVersion = "export default function Page() { return <main>MCP</main>; }\n";
    await PUT(context({ slug, method: "PUT", body: mcpVersion }));

    const response = await PUT(
      context({
        slug,
        method: "PUT",
        body: "export default function Page() { return <main>stale editor</main>; }\n",
        headers: { "X-Dry-Base-Source-Hash": await sourceHash(SAMPLE_SOURCE) },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "conflict" });
    expect(await (await GET(context({ slug }))).text()).toBe(mcpVersion);
  });

  it("auto-creates missing parent folders for a nested path", async () => {
    const put = await PUT(context({ slug: "blogs/[slug]/page.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    expect(put.status).toBe(200);
    const listing = await GET(context({ slug: "blogs/[slug]" }));
    expect(listing.status).toBe(200);
    const body = (await listing.json()) as { entries: { name: string }[] };
    expect(body.entries.map((entry) => entry.name)).toEqual(["page.tsx"]);
  });

  it("rejects a non-.tsx/.ts file name", async () => {
    const put = await PUT(context({ slug: "notes.md", method: "PUT", body: SAMPLE_SOURCE }));
    expect(put.status).toBe(400);
    const body = await put.json();
    expect(body.error).toBe("invalid_path");
  });

  const SAMPLE_CSS = '@theme {\n  --color-brand: red;\n}\n';

  it("accepts a .css file under styles/ and GET reads it back as raw text", async () => {
    const put = await PUT(context({ slug: "styles/theme.css", method: "PUT", body: SAMPLE_CSS }));
    expect(put.status).toBe(200);
    const get = await GET(context({ slug: "styles/theme.css" }));
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(SAMPLE_CSS);
  });

  it("rejects a non-.css file name under styles/", async () => {
    const put = await PUT(context({ slug: "styles/theme.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    expect(put.status).toBe(400);
  });

  it("rejects a .css file name outside styles/", async () => {
    const put = await PUT(context({ slug: "pages/theme.css", method: "PUT", body: SAMPLE_CSS }));
    expect(put.status).toBe(400);
  });
});

describe("POST /dry/api/pages-source/[...slug] (mkdir)", () => {
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

describe("PATCH /dry/api/pages-source/[...slug] (move)", () => {
  it("renames a page file", async () => {
    await PUT(context({ slug: "old/page.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const response = await PATCH(context({ slug: "old/page.tsx", method: "PATCH", ...jsonBody({ action: "move", to: "new/page.tsx" }) }));
    expect(response.status).toBe(200);
    expect((await GET(context({ slug: "old/page.tsx" }))).status).toBe(404);
    expect((await GET(context({ slug: "new/page.tsx" }))).status).toBe(200);
  });

  it("rejects renaming a file to a non-page-source extension", async () => {
    await PUT(context({ slug: "renameable/page.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const response = await PATCH(context({ slug: "renameable/page.tsx", method: "PATCH", ...jsonBody({ action: "move", to: "renameable/page.txt" }) }));
    expect(response.status).toBe(400);
  });
});

describe("DELETE /dry/api/pages-source/[...slug]", () => {
  it("removes a page file", async () => {
    await PUT(context({ slug: "deletable/page.tsx", method: "PUT", body: SAMPLE_SOURCE }));
    const response = await DELETE(context({ slug: "deletable/page.tsx", method: "DELETE" }));
    expect(response.status).toBe(204);
    expect((await GET(context({ slug: "deletable/page.tsx" }))).status).toBe(404);
  });

  it("400s deleting the root", async () => {
    const response = await DELETE(context({ slug: "", method: "DELETE" }));
    expect(response.status).toBe(400);
  });

  it("403s deleting a core styles/ file", async () => {
    await PUT(context({ slug: "styles/globals.css", method: "PUT", body: "@import \"tailwindcss\";" }));
    const response = await DELETE(context({ slug: "styles/globals.css", method: "DELETE" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "protected" });
    expect((await GET(context({ slug: "styles/globals.css" }))).status).toBe(200);
  });

  it("still allows deleting a non-core file inside styles/", async () => {
    await PUT(context({ slug: "styles/extra.css", method: "PUT", body: "/* extra */" }));
    const response = await DELETE(context({ slug: "styles/extra.css", method: "DELETE" }));
    expect(response.status).toBe(204);
  });
});
