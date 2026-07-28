import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultContentTypeDefinitions } from "../seed.js";
import type { ContentTypeDefinition } from "../types.js";
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

describe("validateEntryValue - item count (multi-relation / repeatable component)", () => {
  function withFieldValidation(
    type: ContentTypeDefinition,
    fieldName: string,
    validation: Record<string, unknown>,
  ): ContentTypeDefinition {
    return {
      ...type,
      fields: type.fields.map((f) => (f.name === fieldName ? { ...f, validation } : f)),
    };
  }

  const menu = allTypes.find((t) => t.name === "menu")!;

  it("rejects a manyToMany relation with fewer items than min", () => {
    const nodes = buildEntryFieldTree(withFieldValidation(user, "roles", { min: 2 }), allTypes);
    const errors = validateEntryValue(nodes, {
      name: "Ada",
      email: "a@b.com",
      password: "x",
      roles: ["r1"],
    });
    expect(errors.roles).toBe("Roles must have at least 2 items.");
  });

  it("rejects a manyToMany relation with more items than max", () => {
    const nodes = buildEntryFieldTree(withFieldValidation(user, "roles", { max: 1 }), allTypes);
    const errors = validateEntryValue(nodes, {
      name: "Ada",
      email: "a@b.com",
      password: "x",
      roles: ["r1", "r2"],
    });
    expect(errors.roles).toBe("Roles must have at most 1 item.");
  });

  it("passes a manyToMany relation within min/max bounds", () => {
    const nodes = buildEntryFieldTree(withFieldValidation(user, "roles", { min: 1, max: 2 }), allTypes);
    const errors = validateEntryValue(nodes, {
      name: "Ada",
      email: "a@b.com",
      password: "x",
      roles: ["r1"],
    });
    expect(errors.roles).toBeUndefined();
  });

  it("never count-checks a manyToOne relation, even with min/max stored on it", () => {
    const employee: ContentTypeDefinition = {
      id: "t-employee",
      kind: "collection",
      name: "employee",
      label: "Employee",
      fields: [
        {
          id: "f-manager",
          name: "manager",
          label: "Manager",
          type: "relation",
          config: { target: "t-employee", cardinality: "manyToOne" },
          validation: { min: 1 },
          order: 0,
        },
      ],
      version: 0,
    };
    const nodes = buildEntryFieldTree(employee, [employee]);
    const errors = validateEntryValue(nodes, { manager: null });
    expect(errors.manager).toBeUndefined();
  });

  it("rejects a repeatable component with fewer items than min", () => {
    const nodes = buildEntryFieldTree(withFieldValidation(menu, "refs", { min: 1 }), allTypes);
    const errors = validateEntryValue(nodes, { name: "Main", refs: [] });
    expect(errors.refs).toBe("Items must have at least 1 item.");
  });

  it("reports both the item-count error and per-item field errors together", () => {
    const nodes = buildEntryFieldTree(withFieldValidation(menu, "refs", { max: 1 }), allTypes);
    const errors = validateEntryValue(nodes, {
      name: "Main",
      refs: [{ label: "", href: "" }, { label: "", href: "" }],
    });
    expect(errors.refs).toBe("Items must have at most 1 item.");
    expect(errors["refs[0].label"]).toBeDefined();
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
