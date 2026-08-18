import { describe, expect, it } from "vitest";
import {
  buildPreviewBridgeScript,
  buildPreviewStorageShimScript,
  PREVIEW_INSPECTOR_CURSOR_MESSAGE,
  PREVIEW_INSPECTOR_HOVER_MESSAGE,
  PREVIEW_TITLE_MESSAGE,
  PREVIEW_VEI_FOCUS_MESSAGE,
  PREVIEW_VEI_MODE_MESSAGE,
} from "./page-preview-engine.js";

describe("Page Builder preview bridge", () => {
  it("toggles VEI at runtime and preserves Shift+Click as the page-action escape hatch", () => {
    const script = buildPreviewBridgeScript({ vei: true, runtimeVeiToggle: true });
    expect(script).toContain(PREVIEW_VEI_MODE_MESSAGE);
    expect(script).toContain("veiMode&&!event.shiftKey");
    expect(script).toContain('classList.toggle("dry-vei-enabled",veiMode)');
    expect(script).toContain(PREVIEW_TITLE_MESSAGE);
    expect(script).toContain(PREVIEW_VEI_FOCUS_MESSAGE);
    expect(script).toContain('scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"})');
    expect(script).toContain("return nodes[i]");
  });

  it("provides isolated in-memory storage to opaque-origin previews", () => {
    const script = buildPreviewStorageShimScript();
    expect(script).toContain('install("localStorage")');
    expect(script).toContain('install("sessionStorage")');
    expect(script).not.toContain("window.parent");
  });

  it("omits code-inspector hover/cursor sync when not requested", () => {
    const script = buildPreviewBridgeScript({ vei: true, runtimeVeiToggle: true });
    expect(script).not.toContain(PREVIEW_INSPECTOR_HOVER_MESSAGE);
    expect(script).not.toContain(PREVIEW_INSPECTOR_CURSOR_MESSAGE);
    expect(script).not.toContain("data-dry-loc");
  });

  it("adds code-inspector hover/cursor sync when requested, independent of VEI", () => {
    const script = buildPreviewBridgeScript({ inspector: true });
    expect(script).toContain(PREVIEW_INSPECTOR_HOVER_MESSAGE);
    expect(script).toContain(PREVIEW_INSPECTOR_CURSOR_MESSAGE);
    expect(script).toContain("data-dry-loc");
    expect(script).toContain("findLocContaining");
    // Independent of VEI mode - `vei` wasn't requested here, so none of its
    // own machinery should be pulled in just because inspector mode is on.
    expect(script).not.toContain("function findMarked");
    expect(script).not.toContain("dry-vei-preview-highlight");
  });

  it("keeps the two highlight overlays visually and structurally separate", () => {
    const script = buildPreviewBridgeScript({ vei: true, runtimeVeiToggle: true, inspector: true });
    expect(script).toContain("dry-vei-preview-highlight");
    expect(script).toContain("dry-inspector-preview-highlight");
  });
});
