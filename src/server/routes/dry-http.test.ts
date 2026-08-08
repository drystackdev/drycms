import type { DryRouteContext } from "../context.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { decodeCallLog } from "../app-router/dry-replay-codec.js";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-dry-http-route-"));
  return { content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { POST } = await import("./dry-http.js");
const { createContentEntryEngineAdapter, createContentEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(body: unknown): DryRouteContext {
  const url = new URL("http://localhost/dry/api/dry-http");
  const request = new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { params: {}, request, url, env: {}, session: null };
}

describe("POST /dry/api/dry-http", () => {
  it("reads a singleton and reports its resource + version in headers", async () => {
    const response = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Dry-Resource")).toBe("systemSettings");
    expect(response.headers.get("X-Dry-Resource-Version")).toBe("0");
    const [entry] = decodeCallLog(await response.text());
    expect(entry).toMatchObject({ kind: "singleton", name: "systemSettings", method: "get" });
  });

  it("bumps X-Dry-Resource-Version after the resource's data actually changes", async () => {
    const entries = createContentEntryEngineAdapter(content);
    const schema = createContentEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const systemSettingsType = allTypes.find((t) => t.name === "systemSettings")!;

    const before = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }));
    const versionBefore = before.headers.get("X-Dry-Resource-Version");

    await entries.saveSingletonEntry(systemSettingsType, allTypes, { data: "changed" });

    const after = await POST(context({ kind: "singleton", name: "systemSettings", method: "get" }));
    expect(after.headers.get("X-Dry-Resource-Version")).not.toBe(versionBefore);
  });

  it("rejects a malformed body instead of throwing an unhandled error", async () => {
    const response = await POST(context({ kind: "nonsense", name: 42 }));
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("internal");
  });

  it("a collection get() by unknown id returns a null result, not an error", async () => {
    const response = await POST(context({ kind: "collection", name: "role", method: "get", idOrSlug: 999999 }));
    expect(response.status).toBe(200);
    const [entry] = decodeCallLog(await response.text());
    expect(entry!.result).toBeNull();
  });
});
