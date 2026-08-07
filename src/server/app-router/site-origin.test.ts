import { afterEach, describe, expect, it } from "vitest";
import { resolveSiteOrigin } from "./site-origin.js";

const ORIGINAL = process.env.APP_DOMAIN;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_DOMAIN;
  else process.env.APP_DOMAIN = ORIGINAL;
});

describe("resolveSiteOrigin", () => {
  it("falls back to the request's own origin when APP_DOMAIN is unset", () => {
    delete process.env.APP_DOMAIN;
    expect(resolveSiteOrigin(new URL("http://localhost:5173/blogs/foo"))).toBe("http://localhost:5173");
  });

  it("prefers APP_DOMAIN when set to a valid http(s) URL, ignoring the request's own origin", () => {
    process.env.APP_DOMAIN = "https://example.com";
    expect(resolveSiteOrigin(new URL("http://localhost:5173/blogs/foo"))).toBe("https://example.com");
  });

  it("strips a path/trailing slash off APP_DOMAIN down to just the origin", () => {
    process.env.APP_DOMAIN = "https://example.com/some/path/";
    expect(resolveSiteOrigin(new URL("http://localhost:5173/"))).toBe("https://example.com");
  });

  it("falls back to the request's origin when APP_DOMAIN is not a valid http(s) URL", () => {
    process.env.APP_DOMAIN = "not-a-url";
    expect(resolveSiteOrigin(new URL("http://localhost:5173/"))).toBe("http://localhost:5173");
  });

  it("falls back to the request's origin when APP_DOMAIN is blank/whitespace", () => {
    process.env.APP_DOMAIN = "   ";
    expect(resolveSiteOrigin(new URL("http://localhost:5173/"))).toBe("http://localhost:5173");
  });
});
