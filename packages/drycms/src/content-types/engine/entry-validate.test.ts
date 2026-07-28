import { describe, expect, it } from "vitest";
import { defaultContentTypeDefinitions } from "../seed.js";
import { buildEntryFieldTree } from "./entry-tree.js";
import { findPasswordChangeErrors, passwordConfirmError, passwordOldRequiredError, type MaskedValue } from "./entry-validate.js";

const allTypes = defaultContentTypeDefinitions();
const user = allTypes.find((t) => t.name === "user")!;
const userNodes = buildEntryFieldTree(user, allTypes);

describe("passwordOldRequiredError", () => {
  it("is undefined when nothing is staged (untouched masked marker)", () => {
    expect(passwordOldRequiredError({ hasExisting: true })).toBeUndefined();
    expect(passwordOldRequiredError({ hasExisting: false })).toBeUndefined();
  });

  it("is undefined on create - there's no existing password to verify against", () => {
    expect(passwordOldRequiredError({ hasExisting: false, new: "hunter2" })).toBeUndefined();
  });

  it("fires on edit when a new password is staged without the current one", () => {
    expect(passwordOldRequiredError({ hasExisting: true, new: "hunter2" })).toBe(
      "Current password is required to set a new password.",
    );
  });

  it("is undefined on edit once the current password is also staged", () => {
    expect(passwordOldRequiredError({ hasExisting: true, old: "old-pass", new: "hunter2" })).toBeUndefined();
  });
});

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

  it("flags a missing current password ahead of a mismatched confirm (old-required takes priority)", () => {
    const errors = findPasswordChangeErrors(userNodes, {
      name: "Ada",
      email: "a@b.com",
      password: { hasExisting: true, new: "hunter2", confirm: "wrong" } satisfies MaskedValue,
    });
    expect(errors.password).toBe("Current password is required to set a new password.");
  });
});
