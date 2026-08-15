import { describe, expect, it } from "vitest";
import { buildPreviewBridgeScript, PREVIEW_VEI_MODE_MESSAGE } from "./page-preview-engine.js";

describe("Page Builder preview bridge", () => {
  it("toggles VEI at runtime and preserves Shift+Click as the page-action escape hatch", () => {
    const script = buildPreviewBridgeScript({ vei: true, runtimeVeiToggle: true });
    expect(script).toContain(PREVIEW_VEI_MODE_MESSAGE);
    expect(script).toContain("veiMode&&!event.shiftKey");
    expect(script).toContain('classList.toggle("dry-vei-enabled",veiMode)');
  });
});
