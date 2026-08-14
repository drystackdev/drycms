import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildZip } from "../storage/zip.js";
import { base64Encode } from "../lib/secret-crypto.js";
import type { DryRouteContext } from "./context.js";
import type { StorageAdapter } from "../storage/types.js";

const ZIP_ENTRIES = [
  { path: "pages/page.tsx", data: new TextEncoder().encode("export default function Page() { return null; }") },
  { path: "component/Card.tsx", data: new TextEncoder().encode("export default function Card() { return null; }") },
];
const ZIP_BASE64 = base64Encode(buildZip(ZIP_ENTRIES));

const mockState = vi.hoisted(() => ({
  pagesSourceStorage: { kind: "r2", binding: "MEDIA_BUCKET", prefix: "" } as { kind: string; binding?: string; prefix?: string; root?: string },
  zipBase64: "",
  getStorageAdapter: vi.fn(),
}));

vi.mock("./config.js", () => ({
  get pagesSourceStorage() {
    return mockState.pagesSourceStorage;
  },
}));
vi.mock("./storage-adapters.js", () => ({ getStorageAdapter: mockState.getStorageAdapter }));
vi.mock("./generated-pages-source-seed.js", () => ({
  get PAGES_SOURCE_SEED_ZIP_BASE64() {
    return mockState.zipBase64;
  },
}));

const { ensurePagesSourceSeeded } = await import("./pages-source-seed.js");

function fakeContext(binding: object = {}): DryRouteContext {
  return { env: { MEDIA_BUCKET: binding } } as unknown as DryRouteContext;
}

function fakeAdapter(markerExists: boolean): { stat: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const stat = vi.fn(async (path: string) => (path === ".seeded" && markerExists ? { path, name: ".seeded", kind: "file" as const } : null));
  const write = vi.fn(async (path: string) => ({ path, name: path, kind: "file" as const }));
  mockState.getStorageAdapter.mockReturnValue({ stat, write } as unknown as StorageAdapter);
  return { stat, write };
}

describe("ensurePagesSourceSeeded", () => {
  beforeEach(() => {
    mockState.pagesSourceStorage = { kind: "r2", binding: "MEDIA_BUCKET", prefix: "" };
    mockState.zipBase64 = ZIP_BASE64;
    mockState.getStorageAdapter.mockReset();
  });

  it("no-ops for kind: local (dev/Node - nothing to seed)", async () => {
    mockState.pagesSourceStorage = { kind: "local", root: "/tmp/x" };
    await ensurePagesSourceSeeded(fakeContext());
    expect(mockState.getStorageAdapter).not.toHaveBeenCalled();
  });

  it("no-ops when the generated zip is empty (a checkout that never ran build:worker)", async () => {
    mockState.zipBase64 = "";
    await ensurePagesSourceSeeded(fakeContext());
    expect(mockState.getStorageAdapter).not.toHaveBeenCalled();
  });

  it("writes every zip entry then the .seeded marker last, when absent", async () => {
    const { write } = fakeAdapter(false);
    await ensurePagesSourceSeeded(fakeContext());
    const writtenPaths = write.mock.calls.map((call) => call[0]);
    expect(writtenPaths).toEqual(["pages/page.tsx", "component/Card.tsx", ".seeded"]);
  });

  it("skips entirely when .seeded already exists (never overwrites a tenant's real edits)", async () => {
    const { write } = fakeAdapter(true);
    await ensurePagesSourceSeeded(fakeContext());
    expect(write).not.toHaveBeenCalled();
  });

  it("per-isolate fast path: a 2nd call for the same binding skips the .seeded stat entirely", async () => {
    const { stat } = fakeAdapter(true);
    const binding = {};
    await ensurePagesSourceSeeded(fakeContext(binding));
    await ensurePagesSourceSeeded(fakeContext(binding));
    expect(stat).toHaveBeenCalledTimes(1);
  });
});
