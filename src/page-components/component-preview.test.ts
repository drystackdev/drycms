import { describe, expect, it } from "vitest";
import { transform } from "sucrase";
import { COMPONENT_PREVIEW_ENTRY_PATH, aliasSpecifierFor, buildComponentPreviewSource } from "./component-preview.js";

describe("aliasSpecifierFor", () => {
  it("rewrites a stored component path into the import alias pages use", () => {
    expect(aliasSpecifierFor("component/Card.tsx")).toBe("@component/Card");
    expect(aliasSpecifierFor("component/ui/Button.tsx")).toBe("@component/ui/Button");
  });
});

describe("buildComponentPreviewSource", () => {
  const source = buildComponentPreviewSource("component/Card.tsx", '{ title: "Title" }');

  it("imports the component through the alias and inlines the generated props", () => {
    expect(source).toContain('from "@component/Card"');
    expect(source).toContain('const dryGeneratedProps = { title: "Title" };');
  });

  it("lets an exported defaultProps win over the generated props", () => {
    expect(source).toContain("dryPreviewExports.defaultProps");
    expect(source).toContain("defaults ?? dryGeneratedProps");
  });

  it("renders an array defaultProps as one variant per entry", () => {
    expect(source).toContain("Array.isArray(defaults) ? defaults : [");
    expect(source).toContain("list.map(");
  });

  it("shows an exported _view as is, ahead of any props path", () => {
    expect(source).toContain("const view = dryPreviewExports._view;");
    expect(source).toContain("if (view !== undefined && view !== null) return view;");
    // Before the default-export guard: a file previewing through `_view`
    // renders that node and never calls the component itself.
    expect(source.indexOf("return view;")).toBeLessThan(source.indexOf("no default export function"));
  });

  it("centers every preview inside a viewport-sized stage", () => {
    expect(source).toContain("display:flex;justify-content:center;align-items:center;width:100dvw;height:100dvh;");
  });

  it("insets the stage by 1rem without overflowing the viewport", () => {
    expect(source).toContain("padding:1rem;");
    // Without this the padding is ADDED to `100dvw`/`100dvh` and every
    // component preview scrolls on both axes.
    expect(source).toContain("box-sizing:border-box;");
  });

  it("paints the stage with the passed-in theme background, defaulting to white", () => {
    expect(source).toContain("background-color:#ffffff;");
    expect(buildComponentPreviewSource("component/Card.tsx", "{}", "rgb(20, 26, 33)")).toContain("background-color:rgb(20, 26, 33);");
  });

  it("compiles - the preview entry is real source `buildPage` has to transform", () => {
    const compiled = transform(source, {
      transforms: ["jsx", "typescript", "imports"],
      jsxPragma: "h",
      jsxFragmentPragma: "Fragment",
      production: true,
    }).code;
    expect(compiled).toContain("@component/Card");
    expect(COMPONENT_PREVIEW_ENTRY_PATH).toBe("__dry-preview-component.tsx");
  });

  it("reports a missing default export as a readable error instead of a render crash", () => {
    expect(source).toContain("has no default export function to preview.");
    expect(source).toContain("component/Card.tsx");
  });
});
