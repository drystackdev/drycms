import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIconifySvg } from "./iconify-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchIconifySvg", () => {
  it("composes a full <svg> from a direct icon body, using the root width/height", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        prefix: "mdi",
        width: 24,
        height: 24,
        icons: { account: { body: '<path d="M0 0"/>' } },
      }),
    );
    const result = await fetchIconifySvg("mdi", ["account"]);
    expect(result.notFound).toEqual([]);
    expect(result.found).toEqual([
      {
        name: "account",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>',
      },
    ]);
  });

  it("resolves an alias to its parent's body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        prefix: "mdi",
        width: 24,
        height: 24,
        aliases: { "thumbs-up": { parent: "thumb-up" } },
        icons: { "thumb-up": { body: '<path d="M1 1"/>' } },
      }),
    );
    const result = await fetchIconifySvg("mdi", ["thumbs-up"]);
    expect(result.found).toEqual([
      {
        name: "thumbs-up",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1"/></svg>',
      },
    ]);
  });

  it("uses a per-icon width/height override when present, instead of the root default", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        prefix: "mdi",
        width: 24,
        height: 24,
        icons: { wide: { body: '<path d="M2 2"/>', width: 48, height: 16, left: -4, top: -2 } },
      }),
    );
    const result = await fetchIconifySvg("mdi", ["wide"]);
    expect(result.found[0]?.svg).toContain('viewBox="-4 -2 48 16"');
  });

  it("reports genuinely missing names via notFound instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        prefix: "mdi",
        width: 24,
        height: 24,
        icons: { account: { body: "<path/>" } },
        not_found: ["nope"],
      }),
    );
    const result = await fetchIconifySvg("mdi", ["account", "nope"]);
    expect(result.found.map((f) => f.name)).toEqual(["account"]);
    expect(result.notFound).toEqual(["nope"]);
  });

  it("returns immediately without a network call when names is empty", async () => {
    const result = await fetchIconifySvg("mdi", []);
    expect(result).toEqual({ found: [], notFound: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a clean error on a non-OK HTTP response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(fetchIconifySvg("mdi", ["account"])).rejects.toThrow(/500/);
  });

  it("throws a clean error when the network request itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await expect(fetchIconifySvg("mdi", ["account"])).rejects.toThrow(/network down/);
  });
});
