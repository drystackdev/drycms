import { describe, expect, it } from "vitest";
import { tailwindStylesheetPaths, tailwindStylesheetSource } from "./tailwind-build.js";

describe("tailwindStylesheetSource", () => {
  it("inlines live relative imports so custom theme utilities can compile", () => {
    const css = tailwindStylesheetSource({
      "styles/globals.css": '@import "tailwindcss";\n@import "./theme.css";\n@import "./base.css";',
      "styles/theme.css": "@theme inline { --color-primary: var(--primary); }",
      "styles/base.css": "body { @apply bg-primary; }",
    });

    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain("--color-primary: var(--primary)");
    expect(css).toContain("@apply bg-primary");
    expect(css).not.toContain('@import "./theme.css"');
  });

  it("fails clearly for a missing or circular local stylesheet", () => {
    expect(() => tailwindStylesheetSource({ "styles/globals.css": '@import "./missing.css";' })).toThrow(
      'Missing Tailwind stylesheet "styles/missing.css"',
    );
    expect(() =>
      tailwindStylesheetSource({
        "styles/globals.css": '@import "./theme.css";',
        "styles/theme.css": '@import "./globals.css";',
      }),
    ).toThrow('Circular Tailwind stylesheet import at "styles/globals.css"');
  });

  it("reports only the imported stylesheet graph", () => {
    expect(
      tailwindStylesheetPaths({
        "styles/globals.css": '@import "./theme.css";',
        "styles/theme.css": "@theme {}",
        "styles/unrelated.css": ".unused {}",
      }),
    ).toEqual(["styles/globals.css", "styles/theme.css"]);
  });
});
