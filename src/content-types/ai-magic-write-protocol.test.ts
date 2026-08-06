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

  it("rejects an unknown kind", () => {
    const result = parseMagicWriteYaml("kind: bogus\n");
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
});
