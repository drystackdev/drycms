import { describe, expect, it } from "vitest";
import { extractWizardJson, parseWizardTurn } from "./ai-wizard-protocol.js";

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
      kind: "done",
      summary: "Done.",
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
    expect(parseWizardTurn({ kind: "done", summary: "x", tables: tooManyTables }).ok).toBe(false);

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
