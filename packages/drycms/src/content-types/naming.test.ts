import { describe, expect, it } from "vitest";
import {
  NamingError,
  quoteIdent,
  toSqlLiteral,
  validateContentTypeDefinition,
  validateContentTypeName,
  validateFieldName,
} from "./naming.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return { id: "f1", name: "body", label: "Body", type: "text", config: {}, validation: {}, ...overrides };
}

function contentType(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "t1", kind: "collection", name: "blog", label: "Blog", fields: [], version: 0, ...overrides };
}

describe("validateContentTypeName", () => {
  it("accepts a plain lowercase name", () => {
    expect(() => validateContentTypeName("blog", [])).not.toThrow();
  });

  it("rejects names starting with a digit or containing invalid characters", () => {
    expect(() => validateContentTypeName("1blog", [])).toThrow(NamingError);
    expect(() => validateContentTypeName("blog post", [])).toThrow(NamingError);
    expect(() => validateContentTypeName("blog_post", [])).toThrow(NamingError);
  });

  it("allows hyphens", () => {
    expect(() => validateContentTypeName("blog-post", [])).not.toThrow();
  });

  it("rejects the reserved 'metadata' name, case-insensitively", () => {
    expect(() => validateContentTypeName("metadata", [])).toThrow(NamingError);
    expect(() => validateContentTypeName("METADATA", [])).toThrow(NamingError);
  });

  it("rejects a case-insensitive duplicate among existing types", () => {
    const existing = [contentType({ id: "other", name: "Blog" })];
    expect(() => validateContentTypeName("blog", existing)).toThrow(NamingError);
  });

  it("allows a name that only collides with itself (excluded by the caller)", () => {
    const others = [contentType({ id: "t2", name: "category" })];
    expect(() => validateContentTypeName("blog", others)).not.toThrow();
  });
});

describe("validateFieldName", () => {
  it("rejects underscores (used as the flatten-prefix separator)", () => {
    expect(() => validateFieldName("meta_title")).toThrow(NamingError);
  });

  it("rejects reserved system column names", () => {
    for (const reserved of ["id", "title", "slug", "draft", "schedule", "parent_id", "position", "target_id"]) {
      expect(() => validateFieldName(reserved)).toThrow(NamingError);
    }
  });

  it("accepts a normal field name", () => {
    expect(() => validateFieldName("summary")).not.toThrow();
  });
});

describe("validateContentTypeDefinition", () => {
  it("rejects two fields with the same name (case-insensitive)", () => {
    const def = contentType({ fields: [field({ id: "a", name: "body" }), field({ id: "b", name: "Body" })] });
    expect(() => validateContentTypeDefinition(def, [])).toThrow(NamingError);
  });

  it("passes for a well-formed definition with unique field names", () => {
    const def = contentType({ fields: [field({ id: "a", name: "body" }), field({ id: "b", name: "summary" })] });
    expect(() => validateContentTypeDefinition(def, [])).not.toThrow();
  });
});

describe("quoteIdent", () => {
  it("wraps in double quotes and escapes embedded quotes", () => {
    expect(quoteIdent("posts")).toBe('"posts"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});

describe("toSqlLiteral", () => {
  it("encodes null/undefined as NULL", () => {
    expect(toSqlLiteral(null)).toBe("NULL");
    expect(toSqlLiteral(undefined)).toBe("NULL");
  });

  it("encodes booleans as 1/0", () => {
    expect(toSqlLiteral(true)).toBe("1");
    expect(toSqlLiteral(false)).toBe("0");
  });

  it("encodes numbers as-is and rejects non-finite numbers", () => {
    expect(toSqlLiteral(42)).toBe("42");
    expect(() => toSqlLiteral(Number.POSITIVE_INFINITY)).toThrow(NamingError);
  });

  it("encodes strings single-quoted, escaping embedded quotes", () => {
    expect(toSqlLiteral("O'Brien")).toBe("'O''Brien'");
  });
});
