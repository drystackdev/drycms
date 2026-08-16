import { describe, expect, it } from "vitest";
import { buildPreviewBridgeScript, buildPreviewStorageShimScript, PREVIEW_TITLE_MESSAGE, PREVIEW_VEI_MODE_MESSAGE } from "./page-preview-engine.js";

describe("Page Builder preview bridge", () => {
  it("toggles VEI at runtime and preserves Shift+Click as the page-action escape hatch", () => {
    const script = buildPreviewBridgeScript({ vei: true, runtimeVeiToggle: true });
    expect(script).toContain(PREVIEW_VEI_MODE_MESSAGE);
    expect(script).toContain("veiMode&&!event.shiftKey");
    expect(script).toContain('classList.toggle("dry-vei-enabled",veiMode)');
    expect(script).toContain(PREVIEW_TITLE_MESSAGE);
  });

  it("provides isolated in-memory storage to opaque-origin previews", () => {
    const script = buildPreviewStorageShimScript();
    expect(script).toContain('install("localStorage")');
    expect(script).toContain('install("sessionStorage")');
    expect(script).not.toContain("window.parent");
  });
});
