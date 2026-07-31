import { describe, expect, it } from "vitest";
import { slugify, slugifyIdentifier } from "./slugify.js";

describe("slugify", () => {
  it("hyphenates words and lowercases", () => {
    expect(slugify("Blog Post")).toBe("blog-post");
  });

  it("strips diacritics, including đ", () => {
    expect(slugify("Số Tiền")).toBe("so-tien");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  Hello World!  ")).toBe("hello-world");
  });
});

describe("slugifyIdentifier", () => {
  it("joins words in camelCase with no separator", () => {
    expect(slugifyIdentifier("Blog Post")).toBe("blogPost");
  });

  it("strips diacritics and produces a valid bare identifier", () => {
    // Regression: this used to come out as "so-tien" via `slugify`, which
    // `content-types/naming.ts`'s `validateFieldName` rejects outright since
    // field names may only contain letters/digits.
    expect(slugifyIdentifier("Số Tiền")).toBe("soTien");
  });

  it("camelCases three or more words", () => {
    expect(slugifyIdentifier("The Quick Fox")).toBe("theQuickFox");
  });

  it("collapses punctuation runs into a single word boundary", () => {
    expect(slugifyIdentifier("hello -- world")).toBe("helloWorld");
  });
});
