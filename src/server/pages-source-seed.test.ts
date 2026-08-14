import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DryRouteContext } from "./context.js";
import type { StorageAdapter } from "../storage/types.js";
import { SAMPLE_PAGES_SOURCE_FILES } from "./app-router/sample-pages-source.js";

const mockState = vi.hoisted(() => ({
  pagesSourceStorage: { kind: "r2", binding: "MEDIA_BUCKET", prefix: "" } as { kind: string; binding?: string; prefix?: string; root?: string },
  getStorageAdapter: vi.fn(),
}));

vi.mock("./config.js", () => ({
  get pagesSourceStorage() {
    return mockState.pagesSourceStorage;
  },
}));
vi.mock("./storage-adapters.js", () => ({ getStorageAdapter: mockState.getStorageAdapter }));

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
    mockState.getStorageAdapter.mockReset();
  });

  it("no-ops for kind: local", async () => {
    mockState.pagesSourceStorage = { kind: "local", root: "/tmp/x" };
    await ensurePagesSourceSeeded(fakeContext());
    expect(mockState.getStorageAdapter).not.toHaveBeenCalled();
  });

  it("writes every mock file then the marker last", async () => {
    const { write } = fakeAdapter(false);
    await ensurePagesSourceSeeded(fakeContext({ fresh: true }));
    expect(write.mock.calls.map((call) => call[0])).toEqual([...SAMPLE_PAGES_SOURCE_FILES.map((file) => file.path), ".seeded"]);
  });

  it("does not overwrite a previously seeded tenant", async () => {
    const { write } = fakeAdapter(true);
    await ensurePagesSourceSeeded(fakeContext({ existing: true }));
    expect(write).not.toHaveBeenCalled();
  });

  it("uses the per-isolate binding fast path", async () => {
    const { stat } = fakeAdapter(true);
    const binding = { warm: true };
    await ensurePagesSourceSeeded(fakeContext(binding));
    await ensurePagesSourceSeeded(fakeContext(binding));
    expect(stat).toHaveBeenCalledTimes(1);
  });
});
