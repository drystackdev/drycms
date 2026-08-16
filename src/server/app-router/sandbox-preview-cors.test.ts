import { describe, expect, it } from "vitest";
import { isSandboxPreviewModuleRequest } from "../../../vite.config.js";

describe("sandbox preview dev CORS", () => {
  it("allows opaque-origin module scripts", () => {
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "script" })).toBe(true);
  });

  it("does not allow the admin document or arbitrary null-origin fetches", () => {
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "document" })).toBe(false);
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "empty" })).toBe(false);
    expect(isSandboxPreviewModuleRequest({ origin: "https://example.com", "sec-fetch-dest": "script" })).toBe(false);
  });
});
