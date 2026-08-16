import { describe, expect, it } from "vitest";
import { mergeExternalSourceSnapshot } from "./use-page-builder-source.js";

describe("Page Builder external source refresh", () => {
  it("accepts a disk edit when the Page Builder did not edit that path", () => {
    const current = { "pages/blog/page.tsx": "old" };
    expect(mergeExternalSourceSnapshot(current, { "pages/blog/page.tsx": "new" }, new Set())).toEqual({
      "pages/blog/page.tsx": "new",
    });
  });

  it("preserves only paths explicitly edited inside Page Builder", () => {
    const current = { "pages/blog/page.tsx": "local", "pages/about/page.tsx": "old" };
    const fresh = { "pages/blog/page.tsx": "external", "pages/about/page.tsx": "new" };
    expect(mergeExternalSourceSnapshot(current, fresh, new Set(["pages/blog/page.tsx"]))).toEqual({
      "pages/blog/page.tsx": "local",
      "pages/about/page.tsx": "new",
    });
  });
});
