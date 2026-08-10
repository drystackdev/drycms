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

  it("lets an exported _preview win over the generated props", () => {
    expect(source).toContain("preview ?? dryGeneratedProps");
  });

  it("renders an array _preview as one variant per entry", () => {
    expect(source).toContain("Array.isArray(preview) ? preview : [");
    expect(source).toContain("list.map(");
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
