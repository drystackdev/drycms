import { describe, expect, it } from "vitest";
import { minifyCss } from "./minify-css.js";

describe("minifyCss", () => {
  it("collapses a multi-line, indented ruleset to one compact line", () => {
    const css = `.flex {\n  display: flex;\n  color: red;\n}\n\n.hidden {\n  display: none;\n}\n`;
    const result = minifyCss(css);

    expect(result).not.toContain("\n");
    expect(result).toBe(".flex{display:flex;color:red;}.hidden{display:none;}");
  });

  it("strips comments", () => {
    const css = `/* generated */\n.flex {\n  /* inline note */\n  display: flex;\n}\n`;
    const result = minifyCss(css);

    expect(result).not.toContain("/*");
    expect(result).not.toContain("generated");
    expect(result).not.toContain("inline note");
    expect(result).toBe(".flex{display:flex;}");
  });

  it("preserves meaningful whitespace inside quoted string values", () => {
    const css = `.icon::before {\n  content: "a b";\n}\n`;
    const result = minifyCss(css);

    expect(result).toContain('"a b"');
  });

  it("preserves whitespace inside a data: URI wrapped in quotes", () => {
    const css = `.icon {\n  background: url("data:image/svg+xml,%3Csvg a='1 2'%3E%3C/svg%3E");\n}\n`;
    const result = minifyCss(css);

    expect(result).toContain("a='1 2'");
  });

  it("keeps significant whitespace between selectors and property values", () => {
    const css = `@media (min-width: 640px) {\n  .box {\n    margin: 0 10px;\n  }\n}\n`;
    const result = minifyCss(css);

    expect(result).toBe("@media (min-width:640px){.box{margin:0 10px;}}");
  });
});
