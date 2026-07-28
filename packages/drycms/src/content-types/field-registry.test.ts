import { describe, expect, it } from "vitest";
import {
  selectFieldType,
  fieldTypes,
  numberFieldType,
  passwordFieldType,
  relationFieldType,
  relationMirrorFieldType,
  secretKeyFieldType,
  textFieldType,
  type RelationFieldConfig,
} from "./field-registry.js";

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

describe("passwordFieldType", () => {
  it("is registered under the 'password' key", () => {
    expect(fieldTypes.password).toBe(passwordFieldType);
  });

  it("resolves to a TEXT column, marked internal and never FTS-eligible", () => {
    expect(passwordFieldType.shape).toBe("column");
    expect(passwordFieldType.sqlType?.({})).toBe("TEXT");
    expect(passwordFieldType.internal).toBe(true);
    expect(passwordFieldType.fts).toBe(false);
  });
});

describe("secretKeyFieldType", () => {
  it("is registered under the 'secretkey' key, not internal (freely addable)", () => {
    expect(fieldTypes.secretkey).toBe(secretKeyFieldType);
    expect(secretKeyFieldType.internal).toBeUndefined();
  });

  it("resolves to a TEXT column, never FTS-eligible", () => {
    expect(secretKeyFieldType.shape).toBe("column");
    expect(secretKeyFieldType.sqlType?.({})).toBe("TEXT");
    expect(secretKeyFieldType.fts).toBe(false);
  });
});

describe("selectFieldType", () => {
  it("is registered under the 'select' key, defaults to single-value", () => {
    expect(fieldTypes.select).toBe(selectFieldType);
    expect(selectFieldType.defaultConfig).toEqual({ options: [], multiple: false });
  });

  it("resolves to a TEXT column, never FTS-eligible", () => {
    expect(selectFieldType.shape).toBe("column");
    expect(selectFieldType.sqlType?.({})).toBe("TEXT");
    expect(selectFieldType.fts).toBe(false);
  });

  it("declares an 'options' option-list config field and a 'multiple' toggle", () => {
    const byKey = (key: string) => selectFieldType.configFields?.find((d) => d.key === key);
    expect(byKey("options")).toMatchObject({ widget: "option-list" });
    expect(byKey("multiple")).toMatchObject({ widget: "boolean" });
  });

  it("serializes a multi-value selection as a JSON array, passes a single value through", () => {
    expect(selectFieldType.serialize?.(["a", "b"])).toBe('["a","b"]');
    expect(selectFieldType.serialize?.("a")).toBe("a");
  });

  it("deserializes a JSON array back into an array, a plain string back into a string", () => {
    expect(selectFieldType.deserialize?.('["a","b"]')).toEqual(["a", "b"]);
    expect(selectFieldType.deserialize?.("a")).toBe("a");
  });
});

describe("relationFieldType cardinality", () => {
  const shapeFor = (cardinality: RelationFieldConfig["cardinality"]) =>
    typeof relationFieldType.shape === "function"
      ? relationFieldType.shape({ target: "t", cardinality })
      : relationFieldType.shape;

  it("'manyToOne' resolves to a plain column", () => {
    expect(shapeFor("manyToOne")).toBe("column");
  });

  it("'oneToMany' and 'manyToMany' both resolve to a child table", () => {
    expect(shapeFor("oneToMany")).toBe("child-table");
    expect(shapeFor("manyToMany")).toBe("child-table");
  });

  it("offers exactly the 3 cardinality options", () => {
    const cardinality = relationFieldType.configFields?.find((d) => d.key === "cardinality");
    expect(cardinality?.options?.map((o) => o.value)).toEqual(["manyToOne", "oneToMany", "manyToMany"]);
  });
});

describe("relationMirrorFieldType", () => {
  it("is registered under the 'relationmirror' key, resolves to a virtual shape (no physical storage), and is internal (never manually addable - see system-fields.ts's relationMirrorFieldsFor)", () => {
    expect(fieldTypes.relationmirror).toBe(relationMirrorFieldType);
    expect(relationMirrorFieldType.shape).toBe("virtual");
    expect(relationMirrorFieldType.internal).toBe(true);
  });

  it("has no configFields or validationFields - it's never hand-configured through the Add Field dialog", () => {
    expect(relationMirrorFieldType.configFields).toEqual([]);
    expect(relationMirrorFieldType.validationFields).toEqual([]);
  });
});
