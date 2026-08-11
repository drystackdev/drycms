import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";
import type { DryComponentRecord } from "./component-registry-types.js";
import { exportCleanHtml } from "./html.js";
import { imageStyleString, schema, setRichtextComponents } from "./schema.js";

/**
 * Covers the layout-critical half of the exported markup - the declarations a
 * consumer page (`src/apps/pages/**`, on a Tailwind preflight that resets
 * nearly everything) actually renders CMS content with.
 *
 * The bugs pinned down here were all live on maianhquyen.vn:
 * - `center` exported as `min-width: 100%; margin-inline: auto` on the
 *   `<img>` ITSELF (the uncaptioned case has no wrapper to absorb it), which
 *   inflates the image's own box to the paragraph's full width: a `537x302`
 *   image rendered `100%x302px`, i.e. stretched, and an unsized one scaled up
 *   to the column width.
 * - `object-fit` was tied to `lockAspectRatio`, editor-only state that resets
 *   on reload - so it silently vanished from the export, leaving a clamped
 *   image with nothing to keep its ratio.
 * - A `block` component exported as a bare `<dry-x>`, which a browser lays
 *   out inline until (and unless) its script upgrades the element.
 *
 * DOM-free like its neighbours (`grid.test.ts`'s own comment explains why the
 * import direction isn't covered here) - `parseImageAlign` reads styles off a
 * real element, so its round-trip is the Playwright check's job.
 */

function docOf(...blocks: PMNode[]) {
  return schema.nodes.doc!.create(null, blocks);
}

function imageParagraph(attrs: Record<string, unknown>) {
  return schema.nodes.paragraph!.create(null, schema.nodes.image!.create({ src: "a.png", ...attrs }));
}

describe("imageStyleString align encoding", () => {
  it("centers with display + auto margins, never by stretching the image's own box", () => {
    const style = imageStyleString(537, 302, "center", "contain");

    expect(style).toContain("display:block");
    expect(style).toContain("margin-inline:auto");
    expect(style).not.toContain("min-width");
  });

  it("keeps the float/margin encoding for left and right", () => {
    expect(imageStyleString(null, null, "left", null)).toBe("float:left;margin-inline-end:1em;margin-block:0.5em");
    expect(imageStyleString(null, null, "right", null)).toBe("float:right;margin-inline-start:1em;margin-block:0.5em");
  });

  it("writes no align declarations at all for an unaligned image", () => {
    expect(imageStyleString(400, null, null, "contain")).toBe("width:400px;max-width:none;object-fit:contain");
  });

  it("leaves an unsized image's object-fit out - there is no box for it to act on", () => {
    expect(imageStyleString(null, null, "center", "contain")).toBe("display:block;margin-inline:auto");
  });
});

describe("exportCleanHtml image layout", () => {
  it("exports a centered, locked, resized image without the box-stretching encoding", () => {
    const html = exportCleanHtml(
      docOf(imageParagraph({ width: 537, height: 302, align: "center", lockAspectRatio: true })),
    );

    expect(html).toContain("display:block");
    expect(html).toContain("margin-inline:auto");
    expect(html).toContain("object-fit:contain");
    expect(html).not.toContain("min-width");
  });

  it("keeps object-fit on a locked image, so a page-side width clamp can't stretch it", () => {
    const html = exportCleanHtml(docOf(imageParagraph({ width: 400, height: 200, lockAspectRatio: true })));

    expect(html).toContain("object-fit:contain");
  });

  it("centers a captioned image by its figure, leaving the figure shrink-wrapped", () => {
    const html = exportCleanHtml(
      docOf(imageParagraph({ width: 400, height: 200, align: "center", caption: "cap", lockAspectRatio: true })),
    );

    expect(html).toContain('<figure style="margin:0;display:table;margin-inline:auto">');
    expect(html).not.toContain("min-width");
    // Size and fit stay on the `<img>`; only align moves to the `<figure>`.
    expect(html).toContain(
      '<img src="a.png" alt="" style="width:400px;max-width:none;height:200px;max-height:none;object-fit:contain">',
    );
  });
});

describe("exportCleanHtml dry component layout", () => {
  function record(name: string, type: "block" | "inline"): DryComponentRecord {
    return {
      name,
      label: name,
      description: "",
      requiredInput: true,
      type,
      shadow: true,
      children: false,
      refs: [],
      props: {},
      defaults: {},
      sourcePath: "",
      enabled: true,
    };
  }

  it("marks a block component as a block, so it lays out correctly before its script loads", () => {
    setRichtextComponents([record("hero", "block")]);
    const html = exportCleanHtml(docOf(schema.nodes.dry_hero!.create({ props: {} })));

    expect(html).toBe('<dry-hero props="{}" style="display:block"></dry-hero>');
  });

  it("leaves an inline component inline unless it carries size/align of its own", () => {
    setRichtextComponents([record("badge", "inline")]);
    const html = exportCleanHtml(docOf(schema.nodes.paragraph!.create(null, schema.nodes.dry_badge!.create({ props: {} }))));

    expect(html).toBe('<p><dry-badge props="{}"></dry-badge></p>');
  });
});
