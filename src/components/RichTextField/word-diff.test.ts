import { describe, expect, it } from "vitest";
import { diffWords, htmlToPlainText } from "./word-diff.js";

describe("diffWords", () => {
  it("returns a single same op for identical text", () => {
    expect(diffWords("Hello world", "Hello world")).toEqual([{ type: "same", text: "Hello world" }]);
  });

  it("marks a changed word as a remove+add pair, keeping the rest same", () => {
    const ops = diffWords("The cat sat", "The dog sat");
    expect(ops).toEqual([
      { type: "same", text: "The " },
      { type: "remove", text: "cat" },
      { type: "add", text: "dog" },
      { type: "same", text: " sat" },
    ]);
  });

  it("marks appended text as a trailing add", () => {
    const ops = diffWords("Hello", "Hello world");
    expect(ops).toEqual([
      { type: "same", text: "Hello" },
      { type: "add", text: " world" },
    ]);
  });

  it("marks removed text as a trailing remove", () => {
    const ops = diffWords("Hello world", "Hello");
    expect(ops).toEqual([
      { type: "same", text: "Hello" },
      { type: "remove", text: " world" },
    ]);
  });

  it("handles a fully different passage as one remove + one add", () => {
    expect(diffWords("foo bar", "baz qux")).toEqual([
      { type: "remove", text: "foo bar" },
      { type: "add", text: "baz qux" },
    ]);
  });

  it("handles empty strings", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("", "new")).toEqual([{ type: "add", text: "new" }]);
    expect(diffWords("old", "")).toEqual([{ type: "remove", text: "old" }]);
  });
});

describe("htmlToPlainText", () => {
  it("strips tags and decodes the entities this field's own export can produce", () => {
    expect(htmlToPlainText("<p>Hello <strong>world</strong> &amp; friends</p>")).toBe("Hello world & friends");
  });

  it("turns <br> and block-close tags into newlines", () => {
    expect(htmlToPlainText("<p>Line one</p><p>Line two<br>Line three</p>")).toBe("Line one\n\nLine two\nLine three");
  });
});
