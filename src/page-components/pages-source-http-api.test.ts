import { afterEach, describe, expect, it, vi } from "vitest";
import { createPagesSourceApi } from "./pages-source-http-api.js";

describe("pages-source HTTP save concurrency", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the SHA-256 hash of the editor baseline when supplied", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ entry: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const api = createPagesSourceApi("/dry/api/pages-source");
    await api.save("pages/blog/page.tsx", "local edit", "saved baseline");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("X-Dry-Base-Source-Hash")).toMatch(/^[a-f0-9]{64}$/);
  });
});
