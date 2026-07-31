import type { DryRouteContext } from "../context.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));
const fetchIconifySvgMock = vi.hoisted(() => vi.fn());

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-icons-route-"));
  return { icons: { kind: "local", root: tempDirBox.path } };
});

vi.mock("../../icons/iconify-client.js", () => ({
  fetchIconifySvg: fetchIconifySvgMock,
}));

const { GET, POST, PUT, PATCH, DELETE } = await import("./icons.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

afterEach(() => {
  fetchIconifySvgMock.mockReset();
});

function context(opts: {
  slug?: string;
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/icons/${opts.slug ?? ""}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) url.searchParams.set(key, value);
  const request = new Request(url, {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: opts.headers,
  });
  return { params: { slug: opts.slug }, request, url, env: {} };
}

function jsonBody(body: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

const OK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" fill="red"/></svg>';

async function createIcon(name: string, svg = OK_SVG): Promise<Response> {
  return POST(context({ slug: "", method: "POST", ...jsonBody({ action: "create", name, svg }) }));
}

describe("GET /dry/api/icons/[...slug]", () => {
  it("lists an empty root, paginated", async () => {
    const response = await GET(context({ slug: "" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total: 0, entries: [] });
  });

  it("404s a missing icon", async () => {
    const response = await GET(context({ slug: "nope.svg" }));
    expect(response.status).toBe(404);
  });

  it("streams an icon's bytes with image/svg+xml content-type", async () => {
    await createIcon("Home Outline");
    const response = await GET(context({ slug: "home-outline.svg" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  it("paginates: total reflects every icon, entries are capped to pageSize", async () => {
    for (let i = 0; i < 5; i++) await createIcon(`Page Icon ${i}`);
    const response = await GET(context({ slug: "", query: { page: "0", pageSize: "2" } }));
    const data = (await response.json()) as { total: number; entries: unknown[] };
    expect(data.total).toBeGreaterThanOrEqual(5);
    expect(data.entries).toHaveLength(2);
  });

  it("every listed entry carries a url pointing back at this route", async () => {
    await createIcon("Url Check");
    const response = await GET(context({ slug: "", query: { search: "url-check" } }));
    const data = (await response.json()) as { entries: { url?: string }[] };
    expect(data.entries[0]?.url).toBe("/dry/api/icons/url-check.svg");
  });
});

describe("POST /dry/api/icons/[...slug] (manual create)", () => {
  it("creates an icon from a name + raw svg, sanitizing the content", async () => {
    const response = await createIcon("Dangerous Icon", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>');
    expect(response.status).toBe(201);

    const read = await GET(context({ slug: "dangerous-icon.svg" }));
    const text = await read.text();
    expect(text).not.toContain("script");
    expect(text).toContain("<path");
  });

  it("409s on a colliding slug", async () => {
    await createIcon("Dup Icon");
    const response = await createIcon("Dup Icon");
    expect(response.status).toBe(409);
  });

  it("400s when the svg has nothing safe in it (no <svg> root)", async () => {
    const response = await createIcon("Junk", "not an svg at all");
    expect(response.status).toBe(400);
  });
});

describe("POST /dry/api/icons/[...slug] (Iconify import)", () => {
  it("imports found icons, prefixing the filename with the icon set", async () => {
    fetchIconifySvgMock.mockResolvedValueOnce({
      found: [{ name: "account", svg: OK_SVG }],
      notFound: [],
    });
    const response = await POST(
      context({ slug: "", method: "POST", ...jsonBody({ action: "import", prefix: "mdi", names: ["account"] }) }),
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as { created: { name: string }[]; skipped: unknown[] };
    expect(data.created).toEqual([expect.objectContaining({ name: "mdi-account.svg" })]);
    expect(data.skipped).toEqual([]);
  });

  it("reports notFound names as skipped instead of failing the batch", async () => {
    fetchIconifySvgMock.mockResolvedValueOnce({ found: [], notFound: ["ghost-icon"] });
    const response = await POST(
      context({ slug: "", method: "POST", ...jsonBody({ action: "import", prefix: "mdi", names: ["ghost-icon"] }) }),
    );
    const data = (await response.json()) as { created: unknown[]; skipped: { name: string; reason: string }[] };
    expect(data.created).toEqual([]);
    expect(data.skipped).toEqual([{ name: "ghost-icon", reason: "Not found in Iconify." }]);
  });

  it("skips (rather than fails) an icon that already exists locally", async () => {
    fetchIconifySvgMock.mockResolvedValueOnce({ found: [{ name: "account", svg: OK_SVG }], notFound: [] });
    await POST(context({ slug: "", method: "POST", ...jsonBody({ action: "import", prefix: "mdi", names: ["account"] }) }));

    fetchIconifySvgMock.mockResolvedValueOnce({ found: [{ name: "account", svg: OK_SVG }], notFound: [] });
    const second = await POST(
      context({ slug: "", method: "POST", ...jsonBody({ action: "import", prefix: "mdi", names: ["account"] }) }),
    );
    const data = (await second.json()) as { created: unknown[]; skipped: { reason: string }[] };
    expect(data.created).toEqual([]);
    expect(data.skipped[0]?.reason).toBe("Already exists.");
  });
});

describe("PUT /dry/api/icons/[...slug]", () => {
  it("overwrites an icon's bytes, sanitizing the new content", async () => {
    await createIcon("Editable");
    const response = await PUT(
      context({
        slug: "editable.svg",
        method: "PUT",
        body: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M1 1"/></svg>',
      }),
    );
    expect(response.status).toBe(200);
    const read = await GET(context({ slug: "editable.svg" }));
    const text = await read.text();
    expect(text).not.toContain("onload");
    expect(text).toContain("M1 1");
  });

  it("400s an empty name", async () => {
    const response = await PUT(context({ slug: "", method: "PUT", body: OK_SVG }));
    expect(response.status).toBe(400);
  });
});

describe("PATCH /dry/api/icons/[...slug] (rename)", () => {
  it("renames an icon, leaving the old name gone", async () => {
    await createIcon("Rename Me");
    const response = await PATCH(
      context({ slug: "rename-me.svg", method: "PATCH", ...jsonBody({ action: "rename", to: "renamed" }) }),
    );
    expect(response.status).toBe(200);
    expect((await GET(context({ slug: "rename-me.svg" }))).status).toBe(404);
    expect((await GET(context({ slug: "renamed.svg" }))).status).toBe(200);
  });
});

describe("DELETE /dry/api/icons/[...slug]", () => {
  it("deletes an icon", async () => {
    await createIcon("Delete Me");
    const response = await DELETE(context({ slug: "delete-me.svg", method: "DELETE" }));
    expect(response.status).toBe(204);
    expect((await GET(context({ slug: "delete-me.svg" }))).status).toBe(404);
  });

  it("400s deleting without a name", async () => {
    const response = await DELETE(context({ slug: "", method: "DELETE" }));
    expect(response.status).toBe(400);
  });
});
