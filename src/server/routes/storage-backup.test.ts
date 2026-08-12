import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, describe, expect, it } from "vitest";

const testSession: SessionPayload = { id: 1, name: "Test Admin", email: "test-admin@example.com" };

const tempDirBox = { path: "" };

// Same double `routes/storage.test.ts` uses for its own admin-gate check -
// this route calls `requireSuperAdmin` (not `isSuperAdminSession`), so the
// mock covers that export instead; always-allow here since access control
// itself is `admin-access.ts`'s own concern, not this route's.
import { vi } from "vitest";
vi.mock("../admin-access.js", () => ({
  requireSuperAdmin: async () => null,
}));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-storage-backup-route-"));
  return { storage: { kind: "local", root: tempDirBox.path } };
});

const { GET, POST } = await import("./storage-backup.js");
const { createStorageAdapter } = await import("../../storage/index.js");
const { parseZip, buildZip } = await import("../../storage/zip.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(opts: { method?: string; body?: BodyInit }): DryRouteContext {
  const url = new URL("http://localhost/dry/api/storage-backup");
  const request = new Request(url, { method: opts.method ?? "GET", body: opts.body });
  return { params: {}, request, url, env: {}, session: testSession };
}

describe("GET /dry/api/storage-backup", () => {
  it("streams every file under storage as a zip", async () => {
    const adapter = createStorageAdapter({ kind: "local", root: tempDirBox.path } as never);
    await adapter.write("hello.txt", new TextEncoder().encode("hi there"));
    await adapter.write("photos/nested/pic.bin", new Uint8Array([1, 2, 3, 4]));

    const response = await GET(context({}));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="drycms-media-backup-.*\.zip"/);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const entries = parseZip(bytes);
    const byPath = new Map(entries.map((e) => [e.path, e.data]));
    expect(new TextDecoder().decode(byPath.get("hello.txt"))).toBe("hi there");
    expect(Array.from(byPath.get("photos/nested/pic.bin") ?? [])).toEqual([1, 2, 3, 4]);
  });
});

describe("POST /dry/api/storage-backup", () => {
  it("fully replaces current storage with the uploaded zip's contents", async () => {
    const adapter = createStorageAdapter({ kind: "local", root: tempDirBox.path } as never);
    // Pre-restore state the POST must wipe entirely, including a file whose
    // path isn't present in the zip being restored at all.
    await adapter.write("stale.txt", new TextEncoder().encode("old"));

    const zip = buildZip([
      { path: "restored.txt", data: new TextEncoder().encode("fresh content") },
      { path: "nested/again.txt", data: new TextEncoder().encode("also fresh") },
    ]);
    const file = new File([zip], "backup.zip", { type: "application/zip" });
    const form = new FormData();
    form.append("file", file);

    const response = await POST(context({ method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: true, fileCount: 2 });

    const stale = await adapter.stat("stale.txt");
    expect(stale).toBeNull();
    const restored = await adapter.read("restored.txt");
    const { buffer } = await import("node:stream/consumers");
    expect((await buffer(restored.stream)).toString("utf8")).toBe("fresh content");
  });

  it("rejects a request with no file", async () => {
    const form = new FormData();
    const response = await POST(context({ method: "POST", body: form }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_path");
  });
});
