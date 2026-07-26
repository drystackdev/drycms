import { describe, expect, it } from "vitest";
import { numberFieldType, textFieldType } from "./field-registry.js";

describe("numberFieldType", () => {
  it("defaults step to 1", () => {
    expect(numberFieldType.defaultConfig).toEqual({ step: 1 });
  });
});

describe("textFieldType validationFields", () => {
  const byKey = (key: string) => textFieldType.validationFields?.find((d) => d.key === key);

  it("declares minLength and maxLength as number widgets", () => {
    expect(byKey("minLength")).toMatchObject({ widget: "number" });
    expect(byKey("maxLength")).toMatchObject({ widget: "number" });
  });

  it("declares regex as a text widget", () => {
    expect(byKey("regex")).toMatchObject({ widget: "text" });
  });

  it("declares format as a select widget with none/email/url/slug options", () => {
    const format = byKey("format");
    expect(format?.widget).toBe("select");
    expect(format?.options?.map((o) => o.value)).toEqual(["none", "email", "url", "slug"]);
  });
});
