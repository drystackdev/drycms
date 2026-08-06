import { describe, expect, it } from "vitest";
import {
  extractMagicWriteYaml,
  parseMagicWriteYaml,
  parsePartialMagicWriteYaml,
} from "./ai-magic-write-protocol.js";

const FIELDS_DOC = [
  "kind: fields",
  "summary: |",
  "  Wrote the title and body.",
  "fields:",
  "  title: |",
  "    10 Tips for a Better Morning Routine",
  "  publishedDate: 2026-08-06",
  "  featured: true",
  "  heroImage: photos/cover.jpg",
  "  body: |",
  "    <h2>Wake Up Early</h2>",
  "    <p>Some text.</p>",
  "  author:",
  "    name: |",
  "      Jane Doe",
  "  sections:",
  "    - heading: |",
  "        Section One",
  "      body: |",
  "        <p>First.</p>",
  "    - heading: |",
  "        Section Two",
  "      body: |",
  "        <p>Second.</p>",
].join("\n");

const QUESTION_DOC = [
  "kind: question",
  "topic: tone",
  "question: |",
  "  Which tone should this post use?",
  "multi: false",
  "allowOther: true",
  "choices:",
  "  - id: casual",
  "    label: |",
  "      Casual and friendly",
  "  - id: formal",
  "    label: |",
  "      Formal and professional",
].join("\n");

describe("parseMagicWriteYaml - fields turn", () => {
  it("parses scalars, block literals, nested mappings, and sequences", () => {
    const result = parseMagicWriteYaml(FIELDS_DOC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const turn = result.turn;
    expect(turn.kind).toBe("fields");
    if (turn.kind !== "fields") return;
    expect(turn.summary).toBe("Wrote the title and body.");
    expect(turn.fields.title).toBe("10 Tips for a Better Morning Routine");
    expect(turn.fields.publishedDate).toBe("2026-08-06");
    expect(turn.fields.featured).toBe("true");
    expect(turn.fields.heroImage).toBe("photos/cover.jpg");
    expect(turn.fields.body).toBe("<h2>Wake Up Early</h2>\n<p>Some text.</p>");
    expect(turn.fields.author).toEqual({ name: "Jane Doe" });
    expect(turn.fields.sections).toEqual([
      { heading: "Section One", body: "<p>First.</p>" },
      { heading: "Section Two", body: "<p>Second.</p>" },
    ]);
  });

  it("preserves relative indentation inside a block literal", () => {
    const doc = [
      "kind: fields",
      "summary: |",
      "  s",
      "fields:",
      "  body: |",
      "    <ul>",
      "      <li>one</li>",
      "    </ul>",
    ].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.turn.kind !== "fields") throw new Error("expected fields turn");
    expect(result.turn.fields.body).toBe("<ul>\n  <li>one</li>\n</ul>");
  });

  it("rejects a document missing a required key", () => {
    const result = parseMagicWriteYaml("kind: fields\nfields:\n  title: |\n    x");
    expect(result.ok).toBe(false);
  });

});

describe("parseMagicWriteYaml - lenient chat fallback", () => {
  it("treats an unrecognized kind as chat, using the raw reply as the text", () => {
    const result = parseMagicWriteYaml("kind: bogus\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "chat", text: "kind: bogus" });
  });

  it("treats a reply with no kind: line at all as chat", () => {
    const result = parseMagicWriteYaml("Sure, happy to help with that!");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "chat", text: "Sure, happy to help with that!" });
  });

  it("parses an explicit kind: chat using its own text: block literal", () => {
    const doc = ["kind: chat", "text: |", "  Sure, what tone would you like?"].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "chat", text: "Sure, what tone would you like?" });
  });

  it("still asks for a retry when kind: fields is missing a required key", () => {
    // A real attempt at structured output gone wrong stays retry-worthy -
    // only an unrecognized/missing kind falls back to chat.
    const result = parseMagicWriteYaml("kind: fields\nfields:\n  title: |\n    x");
    expect(result.ok).toBe(false);
  });

  it("still asks for a retry when kind: question has no choices", () => {
    const doc = ["kind: question", "topic: t", "question: |", "  q?", "multi: false"].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(false);
  });
});

describe("parseMagicWriteYaml - question turn", () => {
  it("parses topic/question/choices/multi/allowOther", () => {
    const result = parseMagicWriteYaml(QUESTION_DOC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({
      kind: "question",
      topic: "tone",
      question: "Which tone should this post use?",
      multi: false,
      allowOther: true,
      choices: [
        { id: "casual", label: "Casual and friendly" },
        { id: "formal", label: "Formal and professional" },
      ],
    });
  });

  it("rejects a question turn with no choices", () => {
    const doc = ["kind: question", "topic: t", "question: |", "  q?", "multi: false"].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(false);
  });
});

describe("parseMagicWriteYaml - fetch turn", () => {
  it("parses an entries query with a search term", () => {
    const doc = ["kind: fetch", "source: entries", "typeSlug: blog", "search: mountain"].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "fetch", source: "entries", typeSlug: "blog", id: undefined, search: "mountain", path: undefined });
  });

  it("parses a single-entry query by id", () => {
    const doc = ["kind: fetch", "source: entry", "typeSlug: blog", "id: 12"].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "fetch", source: "entry", typeSlug: "blog", id: "12", search: undefined, path: undefined });
  });

  it("parses a media query with an optional path", () => {
    const doc = ["kind: fetch", "source: media", "path: photos"].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "fetch", source: "media", typeSlug: undefined, id: undefined, search: undefined, path: "photos" });
  });

  it("parses a types query with no other fields", () => {
    const result = parseMagicWriteYaml("kind: fetch\nsource: types");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "fetch", source: "types", typeSlug: undefined, id: undefined, search: undefined, path: undefined });
  });

  it("rejects an unrecognized source", () => {
    const result = parseMagicWriteYaml("kind: fetch\nsource: web");
    expect(result.ok).toBe(false);
  });

  it("rejects entries/entry with no typeSlug", () => {
    expect(parseMagicWriteYaml("kind: fetch\nsource: entries").ok).toBe(false);
    expect(parseMagicWriteYaml("kind: fetch\nsource: entry\nid: 1").ok).toBe(false);
  });

  it("rejects entry with no id", () => {
    const result = parseMagicWriteYaml("kind: fetch\nsource: entry\ntypeSlug: blog");
    expect(result.ok).toBe(false);
  });
});

describe("parseMagicWriteYaml - rewrite turn", () => {
  it("parses the rewritten html block literal", () => {
    const doc = ["kind: rewrite", "html: |", "  <p>Rewritten passage.</p>"].join("\n");
    const result = parseMagicWriteYaml(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toEqual({ kind: "rewrite", html: "<p>Rewritten passage.</p>" });
  });

  it("rejects a rewrite turn with no html", () => {
    const result = parseMagicWriteYaml("kind: rewrite");
    expect(result.ok).toBe(false);
  });

  it("rejects a rewrite turn with an empty html block", () => {
    const result = parseMagicWriteYaml("kind: rewrite\nhtml: |\n");
    expect(result.ok).toBe(false);
  });
});

describe("extractMagicWriteYaml", () => {
  it("strips a markdown fence", () => {
    const wrapped = "```yaml\nkind: fields\nsummary: |\n  s\nfields:\n  a: |\n    b\n```";
    expect(extractMagicWriteYaml(wrapped)).toBe("kind: fields\nsummary: |\n  s\nfields:\n  a: |\n    b");
  });

  it("strips stray prose before the first kind: line", () => {
    const wrapped = "Sure, here you go:\nkind: fields\nsummary: |\n  s\n";
    expect(extractMagicWriteYaml(wrapped)).toBe("kind: fields\nsummary: |\n  s");
  });
});

describe("parsePartialMagicWriteYaml", () => {
  it("reports closed fields and the currently-streaming one", () => {
    const partial = [
      "kind: fields",
      "summary: |",
      "  Wrote the title.",
      "fields:",
      "  title: |",
      "    Full Title Here",
      "  body: |",
      "    <p>Still writ",
    ].join("\n");
    const state = parsePartialMagicWriteYaml(partial);
    expect(state.kind).toBe("fields");
    expect(state.summary).toBe("Wrote the title.");
    expect(state.closedFields).toEqual({ title: "Full Title Here" });
    expect(state.streamingField).toEqual({ name: "body", value: "<p>Still writ" });
  });

  it("grows the streaming field's value as more text arrives", () => {
    const first = parsePartialMagicWriteYaml("kind: fields\nfields:\n  title: |\n    Hel");
    expect(first.streamingField).toEqual({ name: "title", value: "Hel" });
    const second = parsePartialMagicWriteYaml("kind: fields\nfields:\n  title: |\n    Hello world");
    expect(second.streamingField).toEqual({ name: "title", value: "Hello world" });
  });

  it("returns no closed/streaming fields before `fields:` has any children", () => {
    const state = parsePartialMagicWriteYaml("kind: fields\nsummary: |\n  still typ");
    expect(state.closedFields).toEqual({});
    expect(state.streamingField).toBeUndefined();
  });

  it("handles a completely empty or garbage document without throwing", () => {
    expect(parsePartialMagicWriteYaml("").closedFields).toEqual({});
    expect(parsePartialMagicWriteYaml("not yaml at all { }").closedFields).toEqual({});
  });

  it("grows a chat reply's text: block live, for the chat bubble to render mid-stream", () => {
    const first = parsePartialMagicWriteYaml("kind: chat\ntext: |\n  Sure, what to");
    expect(first.kind).toBe("chat");
    expect(first.text).toBe("Sure, what to");
    const second = parsePartialMagicWriteYaml("kind: chat\ntext: |\n  Sure, what tone would you like?");
    expect(second.text).toBe("Sure, what tone would you like?");
  });

  it("grows a question turn's question: block live", () => {
    const state = parsePartialMagicWriteYaml("kind: question\ntopic: tone\nquestion: |\n  Which tone should");
    expect(state.kind).toBe("question");
    expect(state.question).toBe("Which tone should");
  });
});
