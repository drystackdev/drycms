import { describe, expect, it } from "vitest";
import { instrumentJsxSource, instrumentJsxSources } from "./inspector-instrument.js";

/** Pulls every `data-dry-loc="..."` value out of instrumented source, in
 * the order they appear - what the tests below assert against instead of
 * comparing whole-file strings, so they stay readable as the exact
 * attribute-insertion formatting evolves. */
function locs(instrumented: string): string[] {
  return [...instrumented.matchAll(/data-dry-loc="([^"]+)"/g)].map((m) => m[1]!);
}

describe("instrumentJsxSource", () => {
  it("marks a simple host element", () => {
    const source = `export default function Page() {\n  return <div>Hello</div>;\n}\n`;
    const out = instrumentJsxSource("pages/page.tsx", source);
    expect(locs(out)).toEqual(["pages/page.tsx:2:10:2:26"]);
    // Original formatting untouched apart from the one insertion.
    expect(out).toBe(`export default function Page() {\n  return <div data-dry-loc="pages/page.tsx:2:10:2:26">Hello</div>;\n}\n`);
  });

  it("marks nested elements, deepest included", () => {
    const source = `export default function Page() {\n  return <div><span>hi</span></div>;\n}\n`;
    const out = instrumentJsxSource("pages/page.tsx", source);
    expect(locs(out)).toHaveLength(2);
    // Outer element's marker still points at the WHOLE original span
    // (start of "<div>" to end of "</div>"), not shifted by the inner
    // element's own now-longer opening tag.
    expect(out).toContain('data-dry-loc="pages/page.tsx:2:10:2:36">');
    expect(out).toContain('data-dry-loc="pages/page.tsx:2:15:2:30">');
  });

  it("marks a self-closing element", () => {
    const source = `export default function Page() {\n  return <img src="a.png" />;\n}\n`;
    const out = instrumentJsxSource("pages/page.tsx", source);
    expect(locs(out)).toHaveLength(1);
    expect(out).toMatch(/<img data-dry-loc="[^"]+" src="a\.png" \/>/);
  });

  it("skips component elements (capitalized tag)", () => {
    const source = `import Card from "@component/Card.js";\nexport default function Page() {\n  return <Card title="x" />;\n}\n`;
    expect(locs(instrumentJsxSource("pages/page.tsx", source))).toEqual([]);
  });

  it("skips fragments and namespaced/member tags", () => {
    const source = `export default function Page() {\n  return <>{cond ? <a.b /> : null}</>;\n}\n`;
    expect(locs(instrumentJsxSource("pages/page.tsx", source))).toEqual([]);
  });

  it("marks elements inside conditional and .map rendering", () => {
    const source = [
      "export default function Page({ items }) {",
      "  return (",
      "    <div>",
      "      {items.map((item) => <li key={item.id}>{item.name}</li>)}",
      "      {items.length === 0 && <p>Empty</p>}",
      "    </div>",
      "  );",
      "}",
      "",
    ].join("\n");
    const out = instrumentJsxSource("pages/page.tsx", source);
    // div + li + p
    expect(locs(out)).toHaveLength(3);
  });

  it("handles an element that already has attributes and a spread", () => {
    const source = `export default function Page(props) {\n  return <div class="x" {...props}>y</div>;\n}\n`;
    const out = instrumentJsxSource("pages/page.tsx", source);
    expect(out).toMatch(/<div data-dry-loc="[^"]+" class="x" \{\.\.\.props\}>y<\/div>/);
  });

  it("never throws on malformed/unterminated source", () => {
    // TS's parser is error-recovering (no exception for merely malformed
    // text - real value of the try/catch in `instrumentJsxSource` is
    // against a genuinely unexpected crash, not this), so the only thing
    // worth asserting here is that garbage input never brings the preview
    // build down.
    const source = `export default function Page() {\n  return <div>{{{{ broken\n}\n`;
    expect(() => instrumentJsxSource("pages/page.tsx", source)).not.toThrow();
  });

  it("returns the source unchanged when there is no JSX at all", () => {
    const source = `export function add(a: number, b: number) {\n  return a + b;\n}\n`;
    expect(instrumentJsxSource("pages/util.tsx", source)).toBe(source);
  });
});

describe("instrumentJsxSources", () => {
  it("only instruments .tsx entries, passes everything else through", () => {
    const sourceByPath = {
      "pages/page.tsx": `export default function Page() {\n  return <div />;\n}\n`,
      "styles/globals.css": "body { color: red; }",
      "component/helpers.ts": "export const x = 1;",
    };
    const out = instrumentJsxSources(sourceByPath);
    expect(locs(out["pages/page.tsx"]!)).toHaveLength(1);
    expect(out["styles/globals.css"]).toBe(sourceByPath["styles/globals.css"]);
    expect(out["component/helpers.ts"]).toBe(sourceByPath["component/helpers.ts"]);
  });
});
