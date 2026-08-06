import { describe, expect, it } from "vitest";
import { exportFragmentHtml } from "./html.js";
import { schema } from "./schema.js";

/**
 * `exportFragmentHtml` (status/magic-write.md Phase 4's "rewrite selection")
 * - export-only, so (like `marks.test.ts`) no DOMParser/jsdom dependency;
 * `importCleanHtmlFragment`/`replaceSelectionWithHtml` go through
 * `DOMParser` the same way `importCleanHtml` already does and are covered
 * by Playwright instead, not here.
 */
function paragraph(text: string) {
  return schema.nodes.paragraph!.create(null, schema.text(text));
}

describe("exportFragmentHtml", () => {
  it("exports a single-paragraph fragment the same as exportCleanHtml would", () => {
    const fragment = schema.nodes.doc!.create(null, paragraph("Hello")).content;
    expect(exportFragmentHtml(fragment)).toBe("<p>Hello</p>");
  });

  it("exports every top-level block in the fragment", () => {
    const fragment = schema.nodes.doc!.create(null, [paragraph("One"), paragraph("Two")]).content;
    expect(exportFragmentHtml(fragment)).toBe("<p>One</p><p>Two</p>");
  });

  it("exports an empty fragment as an empty string", () => {
    const fragment = schema.nodes.doc!.create(null, []).content;
    expect(exportFragmentHtml(fragment)).toBe("");
  });
});
