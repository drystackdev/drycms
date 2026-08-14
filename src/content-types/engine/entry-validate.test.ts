import { describe, expect, it } from "vitest";
import { defaultContentTypeDefinitions } from "../seed.js";
import { buildEntryFieldTree } from "./entry-tree.js";
import { findPasswordChangeErrors, passwordConfirmError, type MaskedValue } from "./entry-validate.js";
import { validateEntryValue } from "./entry-validate.js";
import type { EntryFieldNode } from "./entry-tree.js";

const allTypes = defaultContentTypeDefinitions();
const user = allTypes.find((t) => t.name === "user")!;
const userNodes = buildEntryFieldTree(user, allTypes);
const menu = allTypes.find((t) => t.name === "menu")!;
const menuNodes = buildEntryFieldTree(menu, allTypes);

describe("passwordConfirmError", () => {
  it("is undefined when nothing is staged", () => {
    expect(passwordConfirmError({ hasExisting: false })).toBeUndefined();
  });

  it("is undefined when confirm matches new", () => {
    expect(passwordConfirmError({ hasExisting: false, new: "hunter2", confirm: "hunter2" })).toBeUndefined();
  });

  it("fires when confirm doesn't match new", () => {
    expect(passwordConfirmError({ hasExisting: false, new: "hunter2", confirm: "hunter3" })).toBe("Passwords do not match.");
  });

  it("fires when new is staged but confirm is still blank", () => {
    expect(passwordConfirmError({ hasExisting: false, new: "hunter2" })).toBe("Passwords do not match.");
  });
});

describe("findPasswordChangeErrors", () => {
  it("returns no errors for a fully untouched entry", () => {
    const errors = findPasswordChangeErrors(userNodes, {
      name: "Ada",
      email: "a@b.com",
      password: { hasExisting: true } satisfies MaskedValue,
    });
    expect(errors).toEqual({});
  });

  it("returns no errors for a valid create-mode password + matching confirm", () => {
    const errors = findPasswordChangeErrors(userNodes, {
      name: "Ada",
      email: "a@b.com",
      password: { hasExisting: false, new: "hunter2", confirm: "hunter2" } satisfies MaskedValue,
    });
    expect(errors).toEqual({});
  });

  it("flags a mismatched confirm under the field's own name", () => {
    const errors = findPasswordChangeErrors(userNodes, {
      name: "Ada",
      email: "a@b.com",
      password: { hasExisting: false, new: "hunter2", confirm: "wrong" } satisfies MaskedValue,
    });
    expect(errors.password).toBe("Passwords do not match.");
  });

  it("flags a mismatched confirm on edit too, with no current-password requirement in the way", () => {
    const errors = findPasswordChangeErrors(userNodes, {
      name: "Ada",
      email: "a@b.com",
      password: { hasExisting: true, new: "hunter2", confirm: "wrong" } satisfies MaskedValue,
    });
    expect(errors.password).toBe("Passwords do not match.");
  });
});

describe("RichText required validation", () => {
  const node = (inline: boolean): EntryFieldNode => ({
    kind: "column",
    fieldId: "body",
    fieldName: "body",
    label: "Body",
    columnName: "body",
    fieldType: "richtext",
    fieldConfig: { inline },
    validation: { required: true },
  });

  it("treats an empty paragraph as empty in block mode", () => {
    expect(validateEntryValue([node(false)], { body: "<p></p>" })).toEqual({ body: "Body is required." });
    expect(validateEntryValue([node(false)], { body: "<p>\n&nbsp;<br></p>" })).toEqual({ body: "Body is required." });
  });

  it("keeps inline RichText text-like", () => {
    expect(validateEntryValue([node(true)], { body: "<p></p>" })).toEqual({});
  });
});

describe("URL validation", () => {
  it.each(["/", "/about", "./about", "../about", "?page=2", "#section", "https://example.com/about"])(
    "accepts a valid absolute or browser-relative URL: %s",
    (href) => {
      expect(validateEntryValue(menuNodes, { name: "Main", refs: [{ label: "Link", href }] })).toEqual({});
    },
  );

  it("still rejects text that is not a URL", () => {
    expect(validateEntryValue(menuNodes, { name: "Main", refs: [{ label: "Link", href: "not a url" }] })).toEqual({
      "refs[0].href": "Must be a valid URL.",
    });
  });
});
