import { describe, expect, it } from "vitest";
import { humanizeFieldName, samplePropsSource, sampleValueSource } from "./props-sample.js";

describe("humanizeFieldName", () => {
  it("splits camelCase, snake_case and kebab-case into Title Case", () => {
    expect(humanizeFieldName("heroTitle")).toBe("Hero Title");
    expect(humanizeFieldName("hero_title")).toBe("Hero Title");
    expect(humanizeFieldName("hero-title")).toBe("Hero Title");
    expect(humanizeFieldName("title")).toBe("Title");
  });
});

describe("sampleValueSource", () => {
  it("names a plain string after the prop it belongs to", () => {
    expect(sampleValueSource({ kind: "string" }, "ctaLabel")).toBe('"Cta Label"');
  });

  it("recognizes link, image and prose props by name", () => {
    expect(sampleValueSource({ kind: "string" }, "href")).toBe('"#"');
    expect(sampleValueSource({ kind: "string" }, "imageUrl")).toBe('"#"');
    expect(sampleValueSource({ kind: "string" }, "src")).toContain("data:image/svg+xml");
    expect(sampleValueSource({ kind: "string" }, "description")).toContain("Lorem ipsum");
  });

  it("picks number samples by name, defaulting to 42", () => {
    expect(sampleValueSource({ kind: "number" }, "itemCount")).toBe("3");
    expect(sampleValueSource({ kind: "number" }, "price")).toBe("99");
    expect(sampleValueSource({ kind: "number" }, "year")).toBe("2026");
    expect(sampleValueSource({ kind: "number" }, "weight")).toBe("42");
  });

  it("turns a positive-sounding boolean on so the component actually renders", () => {
    expect(sampleValueSource({ kind: "boolean" }, "showIcon")).toBe("true");
    expect(sampleValueSource({ kind: "boolean" }, "isFeatured")).toBe("true");
    expect(sampleValueSource({ kind: "boolean" }, "disabled")).toBe("false");
  });

  it("takes the first member of a union, and skips unknown members", () => {
    expect(sampleValueSource({ kind: "union", options: [{ kind: "literal", value: "solid" }, { kind: "literal", value: "ghost" }] }, "variant")).toBe(
      '"solid"',
    );
    expect(sampleValueSource({ kind: "union", options: [{ kind: "unknown" }, { kind: "number" }] }, "size")).toBe("3");
  });

  it("fills an array with 3 samples, named from the singular of the prop", () => {
    expect(sampleValueSource({ kind: "array", element: { kind: "object", fields: [{ name: "label", optional: false, type: { kind: "string" } }] } }, "items")).toBe(
      '[{ label: "Label" }, { label: "Label" }, { label: "Label" }]',
    );
  });

  it("returns an empty array when the element type carries no sample", () => {
    expect(sampleValueSource({ kind: "array", element: { kind: "unknown" } }, "rows")).toBe("[]");
  });

  it("samples renderable children as text and functions as a no-op", () => {
    expect(sampleValueSource({ kind: "node" }, "children")).toBe('"Sample content"');
    expect(sampleValueSource({ kind: "function" }, "onClick")).toBe("() => {}");
  });

  it("has no sample for an untyped prop", () => {
    expect(sampleValueSource({ kind: "unknown" }, "whatever")).toBeNull();
  });
});

describe("samplePropsSource", () => {
  it("emits a compilable object literal, optional props included", () => {
    expect(
      samplePropsSource({
        fields: [
          { name: "title", optional: false, type: { kind: "string" } },
          { name: "count", optional: true, type: { kind: "number" } },
          { name: "variant", optional: false, type: { kind: "union", options: [{ kind: "literal", value: "a" }, { kind: "literal", value: "b" }] } },
        ],
      }),
    ).toBe('{ title: "Title", count: 3, variant: "a" }');
  });

  it("omits props with no inferable sample rather than passing undefined", () => {
    expect(
      samplePropsSource({
        fields: [
          { name: "title", optional: false, type: { kind: "string" } },
          { name: "data", optional: true, type: { kind: "unknown" } },
        ],
      }),
    ).toBe('{ title: "Title" }');
  });

  it("quotes a key that isn't a valid identifier", () => {
    expect(samplePropsSource({ fields: [{ name: "data-id", optional: false, type: { kind: "number" } }] })).toBe('{ "data-id": 42 }');
  });

  it("falls back to an empty object with no schema at all", () => {
    expect(samplePropsSource(null)).toBe("{}");
    expect(samplePropsSource({ fields: [] })).toBe("{}");
  });
});
