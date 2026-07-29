import type { APIContext } from "astro";
import { afterAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("virtual:drycms/content-config", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-content-entries-route-"));
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { GET, POST } = await import("./content-entries.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(opts: { slug?: string; method?: string; body?: string; ifVersion?: number }): APIContext {
  const url = new URL(`http://localhost/dry/api/content/${opts.slug ?? ""}`);
  const headers: Record<string, string> = {};
  if (opts.body) headers["content-type"] = "application/json";
  if (opts.ifVersion !== undefined) headers["X-Data-Version"] = String(opts.ifVersion);
  const request = new Request(url, { method: opts.method ?? "GET", body: opts.body, headers });
  return { params: { slug: opts.slug }, request, url } as unknown as APIContext;
}

async function get(slug: string, ifVersion?: number) {
  const response = await GET(context({ slug, ifVersion }));
  return { status: response.status, json: (await response.json()) as any };
}

async function post(slug: string, body: unknown) {
  const response = await POST(context({ slug, method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, json: (await response.json()) as any };
}

describe("content-entries route - data-version protocol", () => {
  it("GET list always includes `version`, `changed: true`, and data when no X-Data-Version is sent", async () => {
    const { json } = await get("role");
    expect(json.changed).toBe(true);
    expect(typeof json.version).toBe("number");
    expect(Array.isArray(json.rows)).toBe(true);
  });

  it("bumps `version` on create, then GET with a stale X-Data-Version returns changed+data while a fresh one returns changed:false with no rows", async () => {
    const before = (await get("role")).json.version as number;

    const created = await post("role", { name: "Editor", isSuperAdmin: false, permissions: [] });
    expect(created.status).toBe(201);

    const stale = await get("role", before);
    expect(stale.json.changed).toBe(true);
    expect(stale.json.version).toBe(before + 1);
    expect(stale.json.rows.some((r: any) => r.value.name === "Editor")).toBe(true);

    const fresh = await get("role", stale.json.version);
    expect(fresh.json).toEqual({ changed: false, version: stale.json.version });
    expect(fresh.json.rows).toBeUndefined();
  });

  it("GET single entry by id honors the same version protocol", async () => {
    const created = await post("role", { name: "Viewer", isSuperAdmin: false, permissions: [] });
    const id = created.json.entry.id as string;

    const first = await get(`role/${id}`);
    expect(first.json.changed).toBe(true);
    expect(first.json.entry.value.name).toBe("Viewer");

    const unchanged = await get(`role/${id}`, first.json.version);
    expect(unchanged.json).toEqual({ changed: false, version: first.json.version });
  });
});
