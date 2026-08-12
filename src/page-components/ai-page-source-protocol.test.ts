import { describe, expect, it } from "vitest";
import { extractPageSourceYaml, parsePageSourceYaml, parsePartialPageSourceYaml } from "./ai-page-source-protocol.js";

describe("parsePageSourceYaml - code turn", () => {
  it("parses path, summary, and code block literals", () => {
    const doc = [
      "kind: code",
      "path: pages/page.tsx",
      "summary: |",
      "  Added a heading.",
      "code: |",
      "  export default function Page() {",
      "    return <h1>Hi</h1>;",
      "  }",
    ].join("\n");
    const result = parsePageSourceYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({
      kind: "code",
      path: "pages/page.tsx",
      summary: "Added a heading.",
      code: "export default function Page() {\n  return <h1>Hi</h1>;\n}",
    });
  });

  it("rejects a code turn with no path", () => {
    const result = parsePageSourceYaml("kind: code\nsummary: |\n  s\ncode: |\n  x");
    expect(result.ok).toBe(false);
  });

  it("rejects a code turn with no code", () => {
    const result = parsePageSourceYaml("kind: code\npath: pages/page.tsx\nsummary: |\n  s");
    expect(result.ok).toBe(false);
  });

  it("rejects a code turn with no summary", () => {
    const result = parsePageSourceYaml("kind: code\npath: pages/page.tsx\ncode: |\n  x");
    expect(result.ok).toBe(false);
  });

  it("rejects a code turn with an empty code block", () => {
    const result = parsePageSourceYaml("kind: code\npath: pages/page.tsx\nsummary: |\n  s\ncode: |\n");
    expect(result.ok).toBe(false);
  });
});

describe("parsePageSourceYaml - read turn", () => {
  it("parses a source-root read", () => {
    const result = parsePageSourceYaml("kind: read\nroot: source\npath: component/Card.tsx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "read", root: "source", path: "component/Card.tsx" });
  });

  it("parses a docs-root read", () => {
    const result = parsePageSourceYaml("kind: read\nroot: docs\npath: docs/ARCHITECTURE.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "read", root: "docs", path: "docs/ARCHITECTURE.md" });
  });

  it("parses a types-root read (the generated dry() types)", () => {
    const result = parsePageSourceYaml("kind: read\nroot: types\npath: types");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "read", root: "types", path: "types" });
  });

  it("rejects an unrecognized root", () => {
    const result = parsePageSourceYaml("kind: read\nroot: web\npath: x");
    expect(result.ok).toBe(false);
  });

  it("rejects a read turn with no path", () => {
    const result = parsePageSourceYaml("kind: read\nroot: source");
    expect(result.ok).toBe(false);
  });
});

describe("parsePageSourceYaml - fetch turn", () => {
  it("parses a types-source fetch", () => {
    const result = parsePageSourceYaml("kind: fetch\nsource: types");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "fetch", source: "types", typeSlug: undefined, id: undefined, search: undefined, path: undefined });
  });

  it("parses an entries-source fetch with a typeSlug and search", () => {
    const result = parsePageSourceYaml("kind: fetch\nsource: entries\ntypeSlug: post\nsearch: hello");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "fetch", source: "entries", typeSlug: "post", id: undefined, search: "hello", path: undefined });
  });

  it("rejects an entry-source fetch missing an id", () => {
    const result = parsePageSourceYaml("kind: fetch\nsource: entry\ntypeSlug: post");
    expect(result.ok).toBe(false);
  });

  it("rejects an unrecognized fetch source", () => {
    const result = parsePageSourceYaml("kind: fetch\nsource: bogus");
    expect(result.ok).toBe(false);
  });
});

describe("parsePageSourceYaml - lenient chat fallback", () => {
  it("treats an unrecognized kind as chat, using the raw reply as the text", () => {
    const result = parsePageSourceYaml("kind: bogus\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "chat", text: "kind: bogus" });
  });

  it("treats a reply with no kind: line at all as chat", () => {
    const result = parsePageSourceYaml("Sure, this file renders the blog index.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "chat", text: "Sure, this file renders the blog index." });
  });

  it("parses an explicit kind: chat using its own text: block literal", () => {
    const doc = ["kind: chat", "text: |", "  This file renders the blog index."].join("\n");
    const result = parsePageSourceYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "chat", text: "This file renders the blog index." });
  });

  it("still asks for a retry when kind: code is missing a required key", () => {
    const result = parsePageSourceYaml("kind: code\npath: pages/page.tsx\nsummary: |\n  s");
    expect(result.ok).toBe(false);
  });
});

describe("extractPageSourceYaml", () => {
  it("strips a markdown fence", () => {
    const wrapped = "```yaml\nkind: chat\ntext: |\n  hi\n```";
    expect(extractPageSourceYaml(wrapped)).toBe("kind: chat\ntext: |\n  hi");
  });

  it("strips stray prose before the first kind: line", () => {
    const wrapped = "Sure, here you go:\nkind: chat\ntext: |\n  hi\n";
    expect(extractPageSourceYaml(wrapped)).toBe("kind: chat\ntext: |\n  hi");
  });
});

describe("parsePartialPageSourceYaml", () => {
  it("grows the code block live as more text arrives", () => {
    const first = parsePartialPageSourceYaml("kind: code\npath: pages/page.tsx\nsummary: |\n  s\ncode: |\n  export default fun");
    expect(first.kind).toBe("code");
    expect(first.path).toBe("pages/page.tsx");
    expect(first.code).toBe("export default fun");
    const second = parsePartialPageSourceYaml("kind: code\npath: pages/page.tsx\nsummary: |\n  s\ncode: |\n  export default function Page() {}");
    expect(second.code).toBe("export default function Page() {}");
  });

  it("exposes path as soon as that line has streamed in, ahead of code", () => {
    const partial = parsePartialPageSourceYaml("kind: code\npath: component/Card.tsx\nsummary: |\n  s\ncode: |\n  export");
    expect(partial.path).toBe("component/Card.tsx");
  });

  it("grows a chat reply's text: block live", () => {
    const first = parsePartialPageSourceYaml("kind: chat\ntext: |\n  This file ren");
    expect(first.kind).toBe("chat");
    expect(first.text).toBe("This file ren");
  });

  it("preserves relative indentation inside the code block literal", () => {
    const doc = ["kind: code", "path: pages/page.tsx", "summary: |", "  s", "code: |", "  function f() {", "    return 1;", "  }"].join("\n");
    const result = parsePageSourceYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.turn.kind !== "code") throw new Error("expected code turn");
    expect(result.turn.code).toBe("function f() {\n  return 1;\n}");
  });

  it("handles a completely empty or garbage document without throwing", () => {
    expect(parsePartialPageSourceYaml("").kind).toBeUndefined();
    expect(parsePartialPageSourceYaml("not yaml at all { }").kind).toBeUndefined();
  });
});
