import { describe, expect, it } from "vitest";
import { isCacheEntryExpired } from "./file-manager-blob-cache.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("isCacheEntryExpired", () => {
  it("is not expired just under 7 days since last access", () => {
    const now = 10 * DAY_MS;
    expect(isCacheEntryExpired(now - 7 * DAY_MS + 1, now)).toBe(false);
  });

  it("is expired just over 7 days since last access", () => {
    const now = 10 * DAY_MS;
    expect(isCacheEntryExpired(now - 7 * DAY_MS - 1, now)).toBe(true);
  });

  it("is not expired for a just-now access", () => {
    const now = 10 * DAY_MS;
    expect(isCacheEntryExpired(now, now)).toBe(false);
  });
});
