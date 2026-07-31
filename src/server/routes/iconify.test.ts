import type { DryRouteContext } from "../context.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./iconify.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function context(endpoint: string, query: Record<string, string> = {}): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/iconify/${endpoint}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return { params: { slug: endpoint }, request: new Request(url), url, env: {} };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /dry/api/iconify/search", () => {
  it("passes the query straight through to Iconify's /search", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ icons: ["mdi:account"], total: 1 }));
    const response = await GET(context("search", { query: "account", prefixes: "mdi", limit: "32" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ icons: ["mdi:account"], total: 1 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("api.iconify.design/search");
    expect(url).toContain("query=account");
    expect(url).toContain("prefixes=mdi");
  });

  it("short-circuits an empty query without calling Iconify", async () => {
    const response = await GET(context("search", { query: "  " }));
    expect(await response.json()).toEqual({ icons: [], total: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits prefixes entirely when not provided (Search all icon sets mode)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ icons: [], total: 0 }));
    await GET(context("search", { query: "home" }));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain("prefixes");
  });
});

describe("GET /dry/api/iconify/collections", () => {
  it("trims each collection down to prefix/name/category", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        mdi: { name: "Material Design Icons", total: 7000, author: { name: "x" }, category: "General" },
      }),
    );
    const response = await GET(context("collections"));
    expect(await response.json()).toEqual({
      mdi: { prefix: "mdi", name: "Material Design Icons", category: "General" },
    });
  });
});

describe("GET /dry/api/iconify/list", () => {
  it("flattens categories, de-dupes names repeated across categories, and sorts", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        prefix: "solar",
        categories: {
          Arrows: ["zebra", "apple"],
          Weather: ["apple", "mango"], // "apple" repeated across categories
        },
        hidden: ["deprecated-one"],
      }),
    );
    const response = await GET(context("list", { prefix: "solar" }));
    expect(await response.json()).toEqual({
      prefix: "solar",
      names: ["apple", "mango", "zebra"],
      total: 3,
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("api.iconify.design/collection?prefix=solar");
  });

  it("includes uncategorized names alongside categorized ones", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ prefix: "mdi", categories: { A: ["a-icon"] }, uncategorized: ["loose-icon"] }),
    );
    const response = await GET(context("list", { prefix: "mdi" }));
    expect(await response.json()).toEqual({ prefix: "mdi", names: ["a-icon", "loose-icon"], total: 2 });
  });
});

describe("GET /dry/api/iconify/icons (preview)", () => {
  it("groups requested ids by prefix and sanitizes each result", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mdi.json")) {
        return jsonResponse({
          prefix: "mdi",
          width: 24,
          height: 24,
          icons: { account: { body: '<path d="M0 0"/>' } },
        });
      }
      if (url.includes("solar.json")) {
        return jsonResponse({
          prefix: "solar",
          width: 24,
          height: 24,
          icons: { home: { body: '<path d="M1 1" onclick="alert(1)"/>' } },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const response = await GET(context("icons", { ids: "mdi:account,solar:home" }));
    const data = (await response.json()) as { icons: Record<string, string> };
    expect(data.icons["mdi:account"]).toContain("<path");
    expect(data.icons["solar:home"]).not.toContain("onclick");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty icons map for a malformed/empty ids param", async () => {
    const response = await GET(context("icons", { ids: "" }));
    expect(await response.json()).toEqual({ icons: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /dry/api/iconify/[unknown]", () => {
  it("404s an unrecognized endpoint", async () => {
    const response = await GET(context("bogus"));
    expect(response.status).toBe(404);
  });
});
