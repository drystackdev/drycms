import type { DryRouteContext } from "../context.js";
import { afterAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-content-entries-route-"));
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { GET, POST, PATCH } = await import("./content-entries.js");
const { createContentEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(opts: { slug?: string; method?: string; body?: string; ifVersion?: number }): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/content/${opts.slug ?? ""}`);
  const headers: Record<string, string> = {};
  if (opts.body) headers["content-type"] = "application/json";
  if (opts.ifVersion !== undefined) headers["X-Data-Version"] = String(opts.ifVersion);
  const request = new Request(url, { method: opts.method ?? "GET", body: opts.body, headers });
  return { params: { slug: opts.slug }, request, url, env: {} };
}

async function get(slug: string, ifVersion?: number) {
  const response = await GET(context({ slug, ifVersion }));
  return { status: response.status, json: (await response.json()) as any };
}

async function post(slug: string, body: unknown) {
  const response = await POST(context({ slug, method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, json: (await response.json()) as any };
}

async function patch(slug: string, body: unknown) {
  const response = await PATCH(context({ slug, method: "PATCH", body: JSON.stringify(body) }));
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as any) };
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

describe("content-entries route - PATCH (reorder)", () => {
  it("bulk-persists sortIndex for a features.sortable collection, and rejects one that isn't sortable", async () => {
    const schema = createContentEngineAdapter(content);
    const item = {
      id: "custom-item",
      kind: "collection" as const,
      name: "item",
      label: "Item",
      features: { sortable: true },
      fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(item, await schema.planSave(item));

    const a = (await post("item", { name: "A" })).json.entry;
    const b = (await post("item", { name: "B" })).json.entry;

    const reordered = await patch("item", {
      updates: [
        { id: b.id, sortIndex: 0 },
        { id: a.id, sortIndex: 1 },
      ],
    });
    expect(reordered.status).toBe(204);

    const listed = await get("item");
    expect(
      listed.json.rows
        .slice()
        .sort((x: any, y: any) => x.value.sortIndex - y.value.sortIndex)
        .map((r: any) => r.value.name),
    ).toEqual(["B", "A"]);

    const rejected = await patch("role", { updates: [] });
    expect(rejected.status).toBe(501);
  });
});
