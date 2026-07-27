import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultContentTypeDefinitions } from "../seed.js";
import { buildEntryFieldTree, type EntryFieldNode } from "./entry-tree.js";
import { applyTimestamps, rowToValue, validateEntryValue, valueToRow, type MaskedValue } from "./entry-codec.js";

const allTypes = defaultContentTypeDefinitions();
const user = allTypes.find((t) => t.name === "user")!;
const userNodes = buildEntryFieldTree(user, allTypes);
const aiKey = allTypes.find((t) => t.name === "aiKey")!;
const aiKeyNodes = buildEntryFieldTree(aiKey, allTypes);

const ORIGINAL_ENV = process.env.DRYCMS_SECRET_KEY;
beforeEach(() => {
  process.env.DRYCMS_SECRET_KEY = "test-passphrase-do-not-use-in-prod";
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DRYCMS_SECRET_KEY;
  else process.env.DRYCMS_SECRET_KEY = ORIGINAL_ENV;
});

describe("rowToValue", () => {
  it("masks a password column instead of returning its hash", () => {
    const value = rowToValue(userNodes, {
      name: "Ada",
      email: "ada@example.com",
      password: "v1:somesaltbase64:somehashbase64",
      createdAt: null,
      updatedAt: null,
    });
    expect(value.password).toEqual({ hasExisting: true } satisfies MaskedValue);
    expect(value.name).toBe("Ada");
    expect(value.email).toBe("ada@example.com");
  });

  it("reports hasExisting: false when the column is null", () => {
    const value = rowToValue(userNodes, { name: "Ada", email: "a@b.com", password: null, createdAt: null, updatedAt: null });
    expect(value.password).toEqual({ hasExisting: false } satisfies MaskedValue);
  });

  it("masks a secretkey column the same way, without decrypting it", () => {
    const value = rowToValue(aiKeyNodes, {
      name: "OpenAI",
      description: null,
      provider: "ChatGPT",
      key: "v1:someIvBase64someCiphertextBase64",
      url: null,
    });
    expect(value.key).toEqual({ hasExisting: true } satisfies MaskedValue);
  });

  it("passes a manyToOne relation's target id through as a plain number", () => {
    const nodes: EntryFieldNode[] = [
      { kind: "relation", fieldName: "author", label: "Author", cardinality: "manyToOne", targetTypeId: "user", columnName: "author_id" },
    ];
    expect(rowToValue(nodes, { author_id: 7 }).author).toBe(7);
    expect(rowToValue(nodes, { author_id: null }).author).toBeNull();
  });
});

describe("valueToRow", () => {
  it("hashes a newly-typed password into the row", async () => {
    const row = await valueToRow(userNodes, { name: "Ada", email: "ada@example.com", password: "hunter2", roles: [] });
    expect(row.password).toMatch(/^v1:/);
    expect(row.password).not.toBe("hunter2");
    expect(row.name).toBe("Ada");
  });

  it("omits the password column when the value is still the masked marker (keep existing on update)", async () => {
    const row = await valueToRow(userNodes, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: true } satisfies MaskedValue,
    });
    expect("password" in row).toBe(false);
  });

  it("writes a manyToOne relation's numeric id to its column", async () => {
    const nodes: EntryFieldNode[] = [
      { kind: "relation", fieldName: "author", label: "Author", cardinality: "manyToOne", targetTypeId: "user", columnName: "author_id" },
    ];
    expect((await valueToRow(nodes, { author: 7 })).author_id).toBe(7);
    expect((await valueToRow(nodes, { author: null })).author_id).toBeNull();
  });

  it("encrypts a newly-typed secretkey into the row", async () => {
    const row = await valueToRow(aiKeyNodes, { name: "OpenAI", provider: "ChatGPT", key: "sk_live_abc" });
    expect(row.key).toMatch(/^v1:/);
    expect(row.key).not.toBe("sk_live_abc");
  });
});

describe("validateEntryValue", () => {
  it("requires the name field", () => {
    const errors = validateEntryValue(userNodes, { name: "", email: "a@b.com", password: "x" });
    expect(errors.name).toBeDefined();
  });

  it("rejects an invalid email format", () => {
    const errors = validateEntryValue(userNodes, { name: "Ada", email: "not-an-email", password: "x" });
    expect(errors.email).toBeDefined();
  });

  it("requires a password on create (masked marker with no existing value)", () => {
    const errors = validateEntryValue(userNodes, {
      name: "Ada",
      email: "a@b.com",
      password: { hasExisting: false } satisfies MaskedValue,
    });
    expect(errors.password).toBeDefined();
  });

  it("does not require a new password when one already exists (edit, left untouched)", () => {
    const errors = validateEntryValue(userNodes, {
      name: "Ada",
      email: "a@b.com",
      password: { hasExisting: true } satisfies MaskedValue,
    });
    expect(errors.password).toBeUndefined();
  });

  it("passes with fully valid data", () => {
    const errors = validateEntryValue(userNodes, { name: "Ada", email: "ada@example.com", password: "hunter2" });
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

describe("applyTimestamps", () => {
  it("stamps both createdAt and updatedAt on create, regardless of what was submitted", () => {
    const row = applyTimestamps(userNodes, { name: "Ada", createdAt: "2000-01-01T00:00:00.000Z" }, "create");
    expect(row.createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(new Date(row.createdAt as string).getTime()).toBeCloseTo(Date.now(), -2);
    expect(new Date(row.updatedAt as string).getTime()).toBeCloseTo(Date.now(), -2);
  });

  it("only stamps updatedAt on update, and drops createdAt from the row entirely", () => {
    const row = applyTimestamps(userNodes, { name: "Ada", createdAt: "2000-01-01T00:00:00.000Z" }, "update");
    expect("createdAt" in row).toBe(false);
    expect(new Date(row.updatedAt as string).getTime()).toBeCloseTo(Date.now(), -2);
  });
});
