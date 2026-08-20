import type { DryRouteContext } from "../context.js";
import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-types-cache-route-"));
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    // The schema itself lives in `content/types.json` under page-source
    // storage now (`schema-document.ts`), not in a `metadata` table.
    pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") },
    typesCacheStorage: { kind: "local", root: join(tempDirBox.path, "types-cache") },
  };
});

const { GET } = await import("./types-cache.js");
const { writeGeneratedDryTypes } = await import("../../content-types/types-cache.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(): DryRouteContext {
  const url = new URL("http://localhost/dry/api/types-cache");
  return { params: {}, request: new Request(url), url, env: {}, session: null };
}

describe("GET /dry/api/types-cache", () => {
  it("lazily generates + persists the cache on a genuine miss, instead of serving blank content", async () => {
    const response = await GET(context());
    expect(response.status).toBe(200);
    const body = await response.text();
    // Built-in content types are always seeded, so a real regeneration
    // against the (empty-of-custom-types but seeded) temp DB names them.
    expect(body).toContain("user");
    expect(body.length).toBeGreaterThan(0);

    // Persisted, not just computed-and-discarded - a second read (which
    // now hits the real cache entry, not the miss branch) returns the
    // exact same content.
    const second = await GET(context());
    expect(await second.text()).toBe(body);
  });

  it("serves the stored cache as-is once one exists, without regenerating it", async () => {
    await writeGeneratedDryTypes("declare const marker: 'stored-verbatim';", context());
    const response = await GET(context());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("declare const marker: 'stored-verbatim';");
  });
});
