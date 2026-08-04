import { describe, expect, it } from "vitest";
import {
  extractWizardJson,
  parsePartialWizardTurn,
  parseWizardTurn,
  repairPartialJson,
} from "./ai-wizard-protocol.js";

describe("parseWizardTurn", () => {
  it("accepts a valid question turn", () => {
    const result = parseWizardTurn({
      kind: "question",
      topic: "table-purpose",
      question: "What is this table for?",
      choices: [{ id: "blog", label: "Blog posts" }, { id: "products", label: "Products" }],
      multi: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.turn).toEqual({
        kind: "question",
        topic: "table-purpose",
        question: "What is this table for?",
        choices: [{ id: "blog", label: "Blog posts" }, { id: "products", label: "Products" }],
        multi: false,
        allowOther: undefined,
      });
    }
  });

  it("rejects a question with no choices", () => {
    const result = parseWizardTurn({ kind: "question", topic: "x", question: "?", choices: [], multi: false });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate choice ids", () => {
    const result = parseWizardTurn({
      kind: "question",
      topic: "x",
      question: "?",
      choices: [{ id: "a", label: "A" }, { id: "a", label: "B" }],
      multi: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicated/);
  });

  it("accepts a valid proposal turn with a new table and a select field", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "Confirm these tables?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [
            { name: "status", label: "Status", type: "select", options: ["draft", "published"] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a table with valid features", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [{ name: "heading", label: "Heading", type: "text" }],
          features: { slug: true, draft: true, timestamps: false },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.turn.kind === "proposal") {
      expect(result.turn.tables[0]!.features).toEqual({ slug: true, draft: true, timestamps: false });
    }
  });

  it("rejects an unrecognized feature key", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [{ name: "heading", label: "Heading", type: "text" }],
          features: { madeUpFeature: true },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/madeUpFeature/);
  });

  it("rejects a non-boolean feature value", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [{ name: "heading", label: "Heading", type: "text" }],
          features: { slug: "yes" },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/slug/);
  });

  it("rejects a select field with no options", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [{ name: "status", label: "Status", type: "select" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/options/);
  });

  it("rejects a relation field with no relationTarget", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [{ name: "author", label: "Author", type: "relation" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/relationTarget/);
  });

  it("rejects an unknown field type", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [{ name: "secret", label: "Secret", type: "password" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/type/);
  });

  it("requires at least one field on a new table", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [{ name: "posts", label: "Posts", kind: "collection", isNew: true, fields: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects removeFields on a new table", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "?",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: true,
          fields: [{ name: "title", label: "Title", type: "text" }],
          removeFields: ["oldField"],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/removeFields/);
  });

  it("accepts an extend-existing table with removeFields and no new fields", () => {
    const result = parseWizardTurn({
      kind: "proposal",
      question: "Here is what I would change.",
      tables: [
        {
          name: "posts",
          label: "Posts",
          kind: "collection",
          isNew: false,
          fields: [],
          removeFields: ["legacyField"],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown top-level kind", () => {
    const result = parseWizardTurn({ kind: "chat", text: "hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/kind/);
  });

  it("rejects a non-object reply", () => {
    expect(parseWizardTurn("not json").ok).toBe(false);
    expect(parseWizardTurn(null).ok).toBe(false);
    expect(parseWizardTurn([1, 2, 3]).ok).toBe(false);
  });

  it("caps tables at 6 and choices at 8", () => {
    const tooManyTables = Array.from({ length: 7 }, (_, index) => ({
      name: `t${index}`,
      label: `T${index}`,
      kind: "collection" as const,
      isNew: true,
      fields: [{ name: "title", label: "Title", type: "text" }],
    }));
    expect(parseWizardTurn({ kind: "proposal", question: "x", tables: tooManyTables }).ok).toBe(false);

    const tooManyChoices = Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, label: `C${index}` }));
    expect(parseWizardTurn({ kind: "question", topic: "x", question: "?", choices: tooManyChoices }).ok).toBe(false);
  });
});

describe("extractWizardJson", () => {
  it("parses bare JSON", () => {
    expect(extractWizardJson('{"kind":"done","summary":"x","tables":[]}')).toEqual({
      kind: "done",
      summary: "x",
      tables: [],
    });
  });

  it("parses JSON surrounded by prose", () => {
    expect(extractWizardJson('Sure, here it is:\n{"kind":"done","summary":"x","tables":[]}\nLet me know!')).toEqual({
      kind: "done",
      summary: "x",
      tables: [],
    });
  });

  it("parses a ```json fenced block", () => {
    expect(extractWizardJson('```json\n{"kind":"done","summary":"x","tables":[]}\n```')).toEqual({
      kind: "done",
      summary: "x",
      tables: [],
    });
  });

  it("returns undefined for unparseable text", () => {
    expect(extractWizardJson("no json here at all")).toBeUndefined();
  });
});

describe("repairPartialJson", () => {
  it("leaves already-complete JSON parseable and unchanged in meaning", () => {
    expect(JSON.parse(repairPartialJson('{"a":1,"b":[1,2]}'))).toEqual({ a: 1, b: [1, 2] });
  });

  it("closes an open string", () => {
    expect(JSON.parse(repairPartialJson('{"question":"Hello wor'))).toEqual({ question: "Hello wor" });
  });

  it("closes open objects and arrays in the correct nesting order", () => {
    expect(JSON.parse(repairPartialJson('{"kind":"question","choices":[{"id":"a","label":"A"},{"id":"b"'))).toEqual({
      kind: "question",
      choices: [{ id: "a", label: "A" }, { id: "b" }],
    });
  });

  it("drops a trailing key-with-no-value colon before closing", () => {
    expect(JSON.parse(repairPartialJson('{"kind":"question","topic"'))).toEqual({ kind: "question" });
  });

  it("drops a trailing comma before closing", () => {
    expect(JSON.parse(repairPartialJson('{"choices":[{"id":"a","label":"A"},'))).toEqual({
      choices: [{ id: "a", label: "A" }],
    });
  });

  it("does not treat an escaped backslash as escaping the next quote", () => {
    // Source text is: {"a":"x\\"  -> a literal backslash followed by an unescaped closing quote.
    const truncated = String.raw`{"a":"x\\"`;
    expect(JSON.parse(repairPartialJson(truncated))).toEqual({ a: "x\\" });
  });

  it("does not close a string early on an escaped quote", () => {
    const truncated = String.raw`{"a":"say \"hi`;
    expect(JSON.parse(repairPartialJson(truncated))).toEqual({ a: 'say "hi' });
  });
});

describe("parsePartialWizardTurn", () => {
  it("returns undefined when there is no JSON object yet", () => {
    expect(parsePartialWizardTurn("")).toBeUndefined();
    expect(parsePartialWizardTurn("Sure, let me think about that")).toBeUndefined();
  });

  it("surfaces the question text as soon as it is present, even mid-word", () => {
    const partial = parsePartialWizardTurn('{"kind":"question","topic":"x","question":"Bạn muốn tạo b');
    expect(partial?.kind).toBe("question");
    expect(partial?.question).toBe("Bạn muốn tạo b");
  });

  it("surfaces completed choices while the last one is still streaming", () => {
    const partial = parsePartialWizardTurn(
      '{"kind":"question","question":"Q","choices":[{"id":"a","label":"Blog posts"},{"id":"b","label":"Prod',
    );
    expect(partial?.choices).toEqual([
      { id: "a", label: "Blog posts" },
      { id: "b", label: "Prod" },
    ]);
  });

  it("omits a choice that has no label yet", () => {
    const partial = parsePartialWizardTurn('{"choices":[{"id":"a"');
    expect(partial?.choices).toEqual([]);
  });

  it("surfaces table name/label/kind/isNew and a running field count", () => {
    const partial = parsePartialWizardTurn(
      '{"kind":"done","summary":"s","tables":[{"name":"posts","label":"Posts","kind":"collection","isNew":true,"fields":[{"name":"title"},{"name":"body"',
    );
    expect(partial?.tables).toEqual([
      { name: "posts", label: "Posts", kind: "collection", isNew: true, fieldCount: 2 },
    ]);
  });

  it("ignores prose before the JSON object", () => {
    const partial = parsePartialWizardTurn('Here is my question:\n{"kind":"question","question":"Q"');
    expect(partial?.question).toBe("Q");
  });

  it("only ever grows/completes as more of the same stream arrives, never throws", () => {
    const full = '{"kind":"question","topic":"intent","question":"Bạn muốn làm gì?","choices":[{"id":"a","label":"Tạo bảng mới"},{"id":"b","label":"Sửa bảng cũ"}],"multi":false}';
    let lastChoiceCount = 0;
    let lastQuestionLength = 0;
    for (let end = 1; end <= full.length; end++) {
      const partial = parsePartialWizardTurn(full.slice(0, end));
      const choiceCount = partial?.choices?.length ?? 0;
      const questionLength = partial?.question?.length ?? 0;
      expect(choiceCount).toBeGreaterThanOrEqual(lastChoiceCount);
      // The question string itself can only grow monotonically once "question" starts appearing (it never gets shorter or disappears once seen, for this fixture's field order).
      if (lastQuestionLength > 0) expect(questionLength).toBeGreaterThanOrEqual(lastQuestionLength);
      lastChoiceCount = choiceCount;
      lastQuestionLength = questionLength;
    }
    const final = parsePartialWizardTurn(full);
    expect(final?.choices).toEqual([
      { id: "a", label: "Tạo bảng mới" },
      { id: "b", label: "Sửa bảng cũ" },
    ]);
  });
});
