import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ContentTypeDefinition } from "../../content-types/types.js";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-content-type-seed-route-"));
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { POST } = await import("./content-type-seed.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { defaultContentTypeDefinitions } = await import("../../content-types/seed.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

let superAdminSession: SessionPayload;

beforeAll(async () => {
  const schema = createContentEngineAdapter(content);
  const entries = createContentEntryEngineAdapter(content);
  const allTypes = await schema.listContentTypes();
  const userType = allTypes.find((t) => t.name === "user")!;
  const roleType = allTypes.find((t) => t.name === "role")!;

  const role = await entries.createEntry(roleType, allTypes, {
    name: "Test Super Admin",
    description: "",
    isSuperAdmin: true,
    permissions: [],
  });
  const user = await entries.createEntry(userType, allTypes, {
    name: "Test Admin",
    email: "test-admin@example.com",
    password: { hasExisting: false, new: "hunter2" },
    roles: [role.id],
  });
  superAdminSession = { id: user.id, name: "Test Admin", email: "test-admin@example.com" };
});

function context(body: unknown, session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/content-type-seed");
  const request = new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { params: {}, request, url, env: {}, session };
}

async function post(body: unknown, session?: SessionPayload | null) {
  const response = await POST(context(body, session));
  return { status: response.status, json: (await response.json()) as any };
}

const APP_TYPE: ContentTypeDefinition = {
  id: "app-post",
  kind: "collection",
  name: "post",
  label: "Post",
  fields: [{ id: "app-post-headline", name: "headline", label: "Headline", type: "text", config: {}, validation: {}, order: 0 }],
  version: 0,
};

describe("POST /dry/api/content-type-seed - kind: schema", () => {
  it("rejects a request from a session without permission", async () => {
    const { status } = await post({ kind: "schema", mode: "plan", contentTypes: [APP_TYPE] }, null);
    expect(status).toBe(401);
  });

  it("rejects an uploaded content type whose id collides with a system type", async () => {
    const systemId = defaultContentTypeDefinitions()[0]!.id;
    const { status, json } = await post({
      kind: "schema",
      mode: "plan",
      contentTypes: [{ ...APP_TYPE, id: systemId }],
    });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_definition");
  });

  it("plans a new app content type as a create with no writes", async () => {
    const { status, json } = await post({ kind: "schema", mode: "plan", contentTypes: [APP_TYPE] });
    expect(status).toBe(200);
    expect(json.mode).toBe("plan");
    expect(json.results).toEqual([{ id: "app-post", label: "Post", kind: "collection", ok: true, destructiveSummary: [] }]);

    const schema = createContentEngineAdapter(content);
    expect(await schema.getContentType("app-post")).toBeNull();
  });

  it("applies an uploaded content type - create then update", async () => {
    const applied = await post({ kind: "schema", mode: "apply", contentTypes: [APP_TYPE] });
    expect(applied.status).toBe(200);
    expect(applied.json.results[0].ok).toBe(true);

    const schema = createContentEngineAdapter(content);
    const created = await schema.getContentType("app-post");
    expect(created?.name).toBe("post");

    // Re-uploading the SAME file (now that the type already exists live) is
    // an update, not a duplicate-create error - `handleBatch`/`performSave`
    // already give this for free via the id match.
    const updated = await post({
      kind: "schema",
      mode: "apply",
      contentTypes: [{ ...APP_TYPE, version: created!.version, label: "Post (renamed)" }],
    });
    expect(updated.json.results[0].ok).toBe(true);
    const renamed = await schema.getContentType("app-post");
    expect(renamed?.label).toBe("Post (renamed)");
  });
});

describe("POST /dry/api/content-type-seed - kind: seed", () => {
  it("plans a singleton with no live row as will-apply, and one with a live row as will-skip", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const systemSettingsType = allTypes.find((t) => t.name === "systemSettings")!;
    const googleVerificationType = allTypes.find((t) => t.name === "googleVerification")!;

    // Give systemSettings a real row up front so its plan comes back "skip".
    await entries.saveSingletonEntry(systemSettingsType, allTypes, { data: "{}" });

    const { status, json } = await post({
      kind: "seed",
      mode: "plan",
      singletonData: {
        [systemSettingsType.id]: { data: "{}" },
        [googleVerificationType.id]: { name: "google-site-verification", content: "abc123" },
      },
    });
    expect(status).toBe(200);
    expect(json.mode).toBe("plan");
    const byId = (id: string) => json.singletons.find((s: any) => s.id === id);
    expect(byId(systemSettingsType.id).willApply).toBe(false);
    expect(byId(googleVerificationType.id).willApply).toBe(true);
  });

  it("applies seed data, then skips it on a second upload - never overwrites live data", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const googleVerificationType = allTypes.find((t) => t.name === "googleVerification")!;

    const body = {
      kind: "seed" as const,
      mode: "apply" as const,
      singletonData: { [googleVerificationType.id]: { name: "google-site-verification", content: "abc123" } },
    };
    const first = await post(body);
    expect(first.json.singletons[0].willApply).toBe(true);
    const row = await entries.getSingletonEntry(googleVerificationType, allTypes);
    expect(row?.value.content).toBe("abc123");

    // Re-apply with DIFFERENT content - must be skipped, not overwritten.
    const second = await post({
      ...body,
      singletonData: { [googleVerificationType.id]: { name: "google-site-verification", content: "different" } },
    });
    expect(second.json.singletons[0].willApply).toBe(false);
    const rowAfter = await entries.getSingletonEntry(googleVerificationType, allTypes);
    expect(rowAfter?.value.content).toBe("abc123");
  });

  it("plans and applies menuData the same all-or-nothing way applyPackagedMenuData already does", async () => {
    const menuRow = { name: "Main Navigation", refs: [{ label: "Home", description: "", href: "https://example.com/" }] };

    const planned = await post({ kind: "seed", mode: "plan", menuData: [menuRow] });
    expect(planned.json.menu.willApply).toBe(true);

    const applied = await post({ kind: "seed", mode: "apply", menuData: [menuRow] });
    expect(applied.json.menu.willApply).toBe(true);

    const rePlanned = await post({ kind: "seed", mode: "plan", menuData: [menuRow] });
    expect(rePlanned.json.menu.willApply).toBe(false);
  });
});
