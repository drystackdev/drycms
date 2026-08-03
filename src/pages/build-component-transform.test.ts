import { h, Fragment } from "preact";
import { describe, expect, it } from "vitest";
import { transformTsxToElement } from "./build-component-transform.js";

describe("transformTsxToElement", () => {
  it("compiles a bare JSX expression into a Preact vnode", () => {
    const vnode = transformTsxToElement(
      `<div style={{ color: "crimson" }}>Hello</div>`,
      h,
      Fragment,
    ) as any;
    expect(vnode.type).toBe("div");
    expect(vnode.props.style).toEqual({ color: "crimson" });
    expect(vnode.props.children).toBe("Hello");
  });

  it("compiles a fragment with multiple children", () => {
    const vnode = transformTsxToElement(
      `<>\n<div>a</div>\n<div>b</div>\n</>`,
      h,
      Fragment,
    ) as any;
    expect(vnode.type).toBe(Fragment);
    expect(vnode.props.children).toHaveLength(2);
  });

  it("compiles and renders an export default Preact component", () => {
    const vnode = transformTsxToElement(
      `export default function Greeting() {
        return <strong>Hello from a component</strong>;
      }`,
      h,
      Fragment,
    ) as any;
    expect(vnode.type.name).toBe("Greeting");
    const rendered = vnode.type(vnode.props) as any;
    expect(rendered.type).toBe("strong");
    expect(rendered.props.children).toBe("Hello from a component");
  });

  it("throws a clear error for invalid syntax", () => {
    expect(() =>
      transformTsxToElement(`<div>unclosed`, h, Fragment),
    ).toThrow();
  });

  it("throws for a real import statement (unsupported in this demo)", () => {
    expect(() =>
      transformTsxToElement(
        `import { x } from "y";\n<div>{x}</div>`,
        h,
        Fragment,
      ),
    ).toThrow();
  });
});
