import { describe, expect, it } from "vitest";
import { isSandboxPreviewModuleRequest } from "../../../vite.config.js";

describe("sandbox preview dev CORS", () => {
  it("allows opaque-origin module scripts", () => {
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "script" })).toBe(true);
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" })).toBe(true);
  });

  it("always marks Vite module URLs even when Fetch Metadata is absent", () => {
    expect(isSandboxPreviewModuleRequest({}, "/node_modules/.vite/deps/preact.js?v=abc")).toBe(true);
    expect(isSandboxPreviewModuleRequest({}, "/node_modules/@prefresh/core/src/index.js?v=abc")).toBe(true);
    expect(isSandboxPreviewModuleRequest({}, "/node_modules/@prefresh/utils/src/index.js?v=abc")).toBe(true);
    expect(isSandboxPreviewModuleRequest({}, "/src/server/app-router/media-src-hook.ts")).toBe(true);
    expect(isSandboxPreviewModuleRequest({}, "/.dry/pages-source/component/Button.tsx")).toBe(true);
  });

  it("does not allow the admin document or arbitrary null-origin fetches", () => {
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "document" })).toBe(false);
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "empty" })).toBe(false);
    expect(isSandboxPreviewModuleRequest({ origin: "null", "sec-fetch-dest": "empty", "sec-fetch-mode": "no-cors" })).toBe(false);
    expect(isSandboxPreviewModuleRequest({ origin: "https://example.com", "sec-fetch-dest": "script" })).toBe(false);
    expect(isSandboxPreviewModuleRequest({}, "/dry/page-builder")).toBe(false);
    expect(isSandboxPreviewModuleRequest({}, "/dry/api/content")).toBe(false);
  });
});
