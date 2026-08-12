import { beforeEach, describe, expect, it, vi } from "vitest";

const { rebuildAffectedPages } = await import("./rebuild-affected-pages.js");

/**
 * Covers exactly the branches that changed in the "code + content = page"
 * fix (see `status/`... the client no longer permission-gates itself before
 * asking the server, and every real failure now reports through `onStatus`
 * instead of failing silently). The deep "actually compile+publish pages"
 * path below (`paths.length > 0`) is unchanged pre-existing behavior that
 * pulls in the real Sucrase build pipeline - out of scope here, same as
 * before this fix.
 */
describe("rebuildAffectedPages", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("always attempts the byResource lookup - no client-side permission pre-check gates it anymore", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ paths: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await rebuildAffectedPages("/dry", "blogPost", []);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/dry/api/pages-build?byResource=blogPost");
    expect(init).toMatchObject({ credentials: "same-origin" });
  });

  it("stays silent when nothing depends on the resource yet - not worth a toast on every save", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ paths: [] }), { status: 200 })));
    const onStatus = vi.fn();

    await rebuildAffectedPages("/dry", "blogPost", [], onStatus);

    expect(onStatus).not.toHaveBeenCalled();
  });

  it("reports a status instead of failing silently when the lookup itself comes back non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    const onStatus = vi.fn();

    await rebuildAffectedPages("/dry", "blogPost", [], onStatus);

    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls[0]![0]).toMatch(/couldn't check which pages to publish/i);
  });

  it("reports a status instead of swallowing a thrown network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const onStatus = vi.fn();

    await rebuildAffectedPages("/dry", "blogPost", [], onStatus);

    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls[0]![0]).toMatch(/publishing failed: offline/i);
  });

  it("never throws even when onStatus itself is omitted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(rebuildAffectedPages("/dry", "blogPost", [])).resolves.toBeUndefined();
  });
});
