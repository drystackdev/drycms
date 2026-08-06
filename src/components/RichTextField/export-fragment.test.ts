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

describe("exportFragmentHtml - inline option", () => {
  // `ai-rewrite-button.tsx`'s "Rewrite selection": `doc.slice(from, to)`
  // for a selection strictly inside one textblock still hands back that
  // textblock as the fragment's own top-level node, since it's the nearest
  // closed ancestor - `inline: true` exists to leave its own tag off, so
  // the passage reads as bare inline content instead of re-wrapping it.
  it("drops the block tag for a heading node when inline is true", () => {
    const fragment = schema.nodes.doc!.create(null, schema.nodes.heading!.create({ level: 2 }, schema.text("Title"))).content;
    expect(exportFragmentHtml(fragment, { inline: true })).toBe("Title");
  });

  it("still includes the block tag when inline is false (the default)", () => {
    const fragment = schema.nodes.doc!.create(null, schema.nodes.heading!.create({ level: 2 }, schema.text("Title"))).content;
    expect(exportFragmentHtml(fragment)).toBe("<h2>Title</h2>");
  });

  it("keeps inline marks intact when unwrapping the block tag", () => {
    const fragment = schema.nodes.doc!.create(null, paragraph("plain")).content;
    const bolded = schema.nodes.doc!.create(
      null,
      schema.nodes.paragraph!.create(null, schema.text("bold", [schema.marks.bold!.create()])),
    ).content;
    expect(exportFragmentHtml(fragment, { inline: true })).toBe("plain");
    expect(exportFragmentHtml(bolded, { inline: true })).toBe("<strong>bold</strong>");
  });

  it("still wraps a non-textblock node (e.g. a list) even when inline is true", () => {
    const list = schema.nodes.bullet_list!.create(null, [
      schema.nodes.list_item!.create(null, paragraph("Item")),
    ]);
    const fragment = schema.nodes.doc!.create(null, list).content;
    expect(exportFragmentHtml(fragment, { inline: true })).toBe("<ul><li>Item</li></ul>");
  });
});
