import type { DryRouteContext } from "../context.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ContentTypeDefinition, FieldDefinition } from "../../content-types/types.js";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-content-types-route-"));
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { GET, POST, PUT, DELETE } = await import("./content-types.js");
const { GET: entriesGET } = await import("./content-entries.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(opts: { slug?: string; method?: string; body?: string; ifVersion?: number }): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/content-types/${opts.slug ?? ""}`);
  const headers: Record<string, string> = {};
  if (opts.body) headers["content-type"] = "application/json";
  if (opts.ifVersion !== undefined) headers["X-Data-Version"] = String(opts.ifVersion);
  const request = new Request(url, { method: opts.method ?? "GET", body: opts.body, headers });
  return { params: { slug: opts.slug }, request, url, env: {} };
}

async function get(id?: string, ifVersion?: number) {
  const response = await GET(context({ slug: id, ifVersion }));
  return { status: response.status, json: (await response.json()) as any };
}

async function post(body: unknown) {
  const response = await POST(context({ method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, json: (await response.json()) as any };
}

async function put(id: string | undefined, body: unknown) {
  const response = await PUT(context({ slug: id, method: "PUT", body: JSON.stringify(body) }));
  return { status: response.status, json: (await response.json()) as any };
}

async function del(id?: string) {
  return DELETE(context({ slug: id, method: "DELETE" }));
}

function field(name: string, overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: `field-${name}`,
    name,
    label: name,
    type: "text",
    config: {},
    validation: {},
    order: 0,
    ...overrides,
  };
}

function type(id: string, name: string, overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return {
    id,
    kind: "collection",
    name,
    label: name,
    fields: [],
    version: 0,
    ...overrides,
  };
}

async function findByName(name: string): Promise<ContentTypeDefinition> {
  const { json } = await get();
  return (json.definitions as ContentTypeDefinition[]).find((t) => t.name === name)!;
}

describe("GET /dry/api/content-types", () => {
  it("lists the built-in default content types on first boot", async () => {
    const { status, json } = await get();
    expect(status).toBe(200);
    expect((json.definitions as ContentTypeDefinition[]).map((t) => t.name).sort()).toEqual([
      "aiKey",
      "menu",
      "menuItem",
      "permission",
      "role",
      "seo",
      "user",
    ]);
    const byName = (name: string) =>
      (json.definitions as ContentTypeDefinition[]).find((t) => t.name === name)!;
    expect(byName("role").hidden).toBe(true);
    expect(byName("permission").hidden).toBe(true);
    expect(byName("aiKey").hidden).toBe(true);
    expect(byName("seo").hidden).toBe(true);
    expect(byName("user").hidden).toBeFalsy();
  });
});

describe("GET /dry/api/content-types/[slug]", () => {
  it("returns a single definition by id", async () => {
    const user = await findByName("user");
    const { status, json } = await get(user.id);
    expect(status).toBe(200);
    expect(json.definition.id).toBe(user.id);
  });

  it("404s a missing id", async () => {
    const { status, json } = await get("does-not-exist");
    expect(status).toBe(404);
    expect(json.error).toBe("not_found");
  });

  it("400s on invalid percent-encoding in the id", async () => {
    const { status, json } = await get("%zz");
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("decodes a percent-encoded id before looking it up", async () => {
    const { status } = await get(encodeURIComponent("weird id, with comma"));
    expect(status).toBe(404); // proves it decoded cleanly rather than 400ing
  });
});

describe("GET /dry/api/content-types - data-version protocol", () => {
  it("always includes `version`/`changed:true`, and a stale X-Data-Version after a create returns changed+data while a fresh one returns changed:false with no definitions", async () => {
    const before = (await get()).json.version as number;
    expect(typeof before).toBe("number");

    const created = await post({ definition: type("custom-version-probe", "versionprobe") });
    expect(created.status).toBe(200);

    const stale = await get(undefined, before);
    expect(stale.json.changed).toBe(true);
    expect(stale.json.version).toBeGreaterThan(before);
    expect(stale.json.definitions.some((d: ContentTypeDefinition) => d.name === "versionprobe")).toBe(true);

    const fresh = await get(undefined, stale.json.version);
    expect(fresh.json).toEqual({ changed: false, version: stale.json.version });
    expect(fresh.json.definitions).toBeUndefined();
  });
});

describe("POST /dry/api/content-types (create)", () => {
  it("creates a new content type using the caller-supplied id, starting at version 1", async () => {
    const { status, json } = await post({ definition: type("custom-a", "notea") });
    expect(status).toBe(200);
    expect(json.definition).toMatchObject({ id: "custom-a", name: "notea", version: 1 });
  });

  it("auto-generates an id when the body omits one", async () => {
    const def = { ...type("ignored", "noteb"), id: undefined };
    const { status, json } = await post({ definition: def });
    expect(status).toBe(200);
    expect(typeof json.definition.id).toBe("string");
    expect(json.definition.id.length).toBeGreaterThan(0);
  });

  it("ignores a caller-supplied version and always starts a new type at 0/1", async () => {
    const { status, json } = await post({ definition: type("custom-c", "notec", { version: 999 }) });
    expect(status).toBe(200); // a real v999 would 409 version_conflict against the fresh row
    expect(json.definition.version).toBe(1);
  });

  it("normalizes field order to array position, ignoring the client-submitted `order`", async () => {
    const { json } = await post({
      definition: type("custom-d", "noted", {
        fields: [field("second", { order: 5 }), field("first", { order: 1 })],
      }),
    });
    expect(json.definition.fields.map((f: FieldDefinition) => [f.name, f.order])).toEqual([
      ["second", 0],
      ["first", 1],
    ]);
  });

  it("400s when the body is missing `definition`", async () => {
    const { status, json } = await post({});
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("400s on an invalid content type name", async () => {
    const { status, json } = await post({ definition: type("custom-bad", "1bad") });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("400s when the name collides with an existing (built-in) type", async () => {
    const { status, json } = await post({ definition: type("custom-collide", "user") });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });
});

describe("PUT /dry/api/content-types/[slug] (update)", () => {
  it("400s when no id is present in the URL", async () => {
    const { status, json } = await put(undefined, { definition: type("x", "x") });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("400s when body.definition.id doesn't match the URL id", async () => {
    await post({ definition: type("custom-e", "notee") });
    const { status, json } = await put("custom-e", { definition: type("other-id", "notee") });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("updates an existing type and bumps its version", async () => {
    await post({ definition: type("custom-f", "notef") });
    const current = (await get("custom-f")).json.definition as ContentTypeDefinition;
    const { status, json } = await put("custom-f", {
      definition: { ...current, label: "Note F v2" },
    });
    expect(status).toBe(200);
    expect(json.definition).toMatchObject({ label: "Note F v2", version: 2 });
  });

  it("409s a version_conflict when the submitted version is stale", async () => {
    await post({ definition: type("custom-g", "noteg") });
    const stale = (await get("custom-g")).json.definition as ContentTypeDefinition;
    await put("custom-g", { definition: { ...stale, label: "first update" } }); // bumps to v2
    const { status, json } = await put("custom-g", { definition: { ...stale, label: "stale update" } });
    expect(status).toBe(409);
    expect(json.error).toBe("version_conflict");
  });

  it("requires confirmation before a destructive change, then applies it once confirmed", async () => {
    await post({ definition: type("custom-h", "noteh", { fields: [field("note")] }) });
    const current = (await get("custom-h")).json.definition as ContentTypeDefinition;

    const check = await put("custom-h", { definition: { ...current, fields: [] } });
    expect(check.status).toBe(200);
    expect(check.json.requiresConfirm).toBe(true);
    expect(check.json.destructiveSummary.some((d: any) => d.kind === "drop-column")).toBe(true);
    // Not applied yet.
    expect((await get("custom-h")).json.definition.fields).toHaveLength(1);

    const applied = await put("custom-h", { definition: { ...current, fields: [] }, confirm: true });
    expect(applied.status).toBe(200);
    expect(applied.json.definition.fields).toEqual([]);
    expect(applied.json.definition.version).toBe(2);
  });

  it("allows freely setting `hidden` on an ordinary, non-frozen content type", async () => {
    const menu = await findByName("menu");
    expect(menu.hidden).toBeFalsy();
    const { status, json } = await put(menu.id, { definition: { ...menu, hidden: true } });
    expect(status).toBe(200);
    expect(json.definition.hidden).toBe(true);
  });

  it("rejects any edit to a frozen content type (role/permission/aiKey)", async () => {
    const role = await findByName("role");
    const { status, json } = await put(role.id, { definition: { ...role, label: "Renamed" } });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("rejects deleting a frozen content type", async () => {
    const permission = await findByName("permission");
    const response = await del(permission.id);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("protected");
  });

  it("rejects deleting a locked-but-not-frozen content type (user)", async () => {
    const user = await findByName("user");
    const response = await del(user.id);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("protected");
  });

  it("rejects editing a protected field on `user` (email/password/roles)", async () => {
    const user = await findByName("user");
    const email = user.fields.find((f) => f.name === "email")!;
    const { status, json } = await put(user.id, {
      definition: {
        ...user,
        fields: user.fields.map((f) => (f.id === email.id ? { ...f, label: "New Label" } : f)),
      },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("rejects removing a protected field on `user` via `deletedFieldIds`", async () => {
    const user = await findByName("user");
    const password = user.fields.find((f) => f.name === "password")!;
    const { status, json } = await put(user.id, {
      definition: { ...user, deletedFieldIds: [password.id] },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("still allows editing user's other (non-protected) fields", async () => {
    const user = await findByName("user");
    const name = user.fields.find((f) => f.name === "name")!;
    const { status, json } = await put(user.id, {
      definition: {
        ...user,
        fields: user.fields.map((f) => (f.id === name.id ? { ...f, label: "Full Name" } : f)),
      },
    });
    expect(status).toBe(200);
    expect(json.definition.fields.find((f: FieldDefinition) => f.id === name.id).label).toBe("Full Name");
  });
});

describe("POST/PUT /dry/api/content-types - singleton auto-first-row", () => {
  it("creates the singleton's first row immediately, even with an unfilled required field", async () => {
    const { status } = await post({
      definition: type("custom-singleton-k", "sitesettingsk", {
        kind: "singleton",
        fields: [field("headline", { validation: { required: true } })],
      }),
    });
    expect(status).toBe(200);

    const entryResponse = await entriesGET(context({ slug: "sitesettingsk" }));
    const entryJson = (await entryResponse.json()) as any;
    expect(entryJson.entry).not.toBeNull();
    expect(entryJson.entry.value.headline).toBeNull();
  });

  it("stays a no-op on a later PUT once the row already exists", async () => {
    await post({
      definition: type("custom-singleton-l", "sitesettingsl", { kind: "singleton", fields: [] }),
    });
    const first = await entriesGET(context({ slug: "sitesettingsl" }));
    const firstId = ((await first.json()) as any).entry.id;

    const current = (await get("custom-singleton-l")).json.definition as ContentTypeDefinition;
    await put("custom-singleton-l", { definition: { ...current, label: "Site Settings L v2" } });

    const second = await entriesGET(context({ slug: "sitesettingsl" }));
    const secondId = ((await second.json()) as any).entry.id;
    expect(secondId).toBe(firstId);
  });
});

describe("DELETE /dry/api/content-types/[slug]", () => {
  it("deletes a custom content type", async () => {
    await post({ definition: type("custom-i", "notei") });
    const response = await del("custom-i");
    expect(response.status).toBe(204);
    expect((await get("custom-i")).status).toBe(404);
  });

  it("404s deleting a missing id", async () => {
    const response = await del("does-not-exist");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("not_found");
  });

  it("400s when no id is present in the URL", async () => {
    const response = await del(undefined);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_definition");
  });

  it("rejects deleting a locked/frozen built-in content type (role)", async () => {
    const role = await findByName("role");
    const response = await del(role.id);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("protected");
    expect((await get(role.id)).status).toBe(200);
  });

  it("409s deleting a component that's still embedded by another content type", async () => {
    await post({ definition: type("comp-card", "cardcomponent", { kind: "component", fields: [field("heading")] }) });
    await post({
      definition: type("custom-j", "pagewithcard", {
        fields: [field("card", { type: "component", config: { componentId: "comp-card", repeatable: false } })],
      }),
    });

    const response = await del("comp-card");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("in_use");
  });
});
