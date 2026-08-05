import { describe, expect, it } from "vitest";
import type { QueryableColumn } from "./entry-tree.js";
import { buildWhereClause, EntryWhereError, type EntryWhere } from "./entry-where.js";

function column(overrides: Partial<QueryableColumn> & { fieldName: string; columnName: string }): QueryableColumn {
  return { fieldId: overrides.fieldName, label: overrides.fieldName, fieldType: "text", fieldConfig: undefined, validation: {}, ...overrides };
}

const queryable: QueryableColumn[] = [
  column({ fieldName: "title", columnName: "title", fieldType: "text" }),
  column({ fieldName: "views", columnName: "views", fieldType: "number" }),
  column({ fieldName: "category", columnName: "category", fieldType: "number" }),
];

describe("buildWhereClause", () => {
  it("returns null for an empty where", () => {
    expect(buildWhereClause(queryable, [])).toBeNull();
  });

  it("renders a single plain condition", () => {
    const result = buildWhereClause(queryable, [{ field: "views", op: "gte", value: 10 }]);
    expect(result?.sql).toBe('"views" >= ?');
    expect(result?.params).toEqual([10]);
  });

  it("ANDs multiple plain conditions", () => {
    const where: EntryWhere = [
      { field: "category", op: "eq", value: 2 },
      { field: "views", op: "ne", value: 0 },
    ];
    const result = buildWhereClause(queryable, where);
    expect(result?.sql).toBe('"category" = ? AND "views" != ?');
    expect(result?.params).toEqual([2, 0]);
  });

  it("renders `in` with its values, and an empty `in` as unconditionally false", () => {
    const withValues = buildWhereClause(queryable, [{ field: "category", op: "in", value: [1, 2, 3] }]);
    expect(withValues?.sql).toBe('"category" IN (?,?,?)');
    expect(withValues?.params).toEqual([1, 2, 3]);

    const empty = buildWhereClause(queryable, [{ field: "category", op: "in", value: [] }]);
    expect(empty?.sql).toBe("0");
    expect(empty?.params).toEqual([]);
  });

  it("renders a null value as IS [NOT] NULL instead of `= NULL`", () => {
    const eqNull = buildWhereClause(queryable, [{ field: "category", op: "eq", value: null }]);
    expect(eqNull?.sql).toBe('"category" IS NULL');
    expect(eqNull?.params).toEqual([]);

    const neNull = buildWhereClause(queryable, [{ field: "category", op: "ne", value: null }]);
    expect(neNull?.sql).toBe('"category" IS NOT NULL');
  });

  it("throws EntryWhereError for an unqueryable/unknown field", () => {
    expect(() => buildWhereClause(queryable, [{ field: "nope", op: "eq", value: 1 }])).toThrow(EntryWhereError);
    expect(() => buildWhereClause(queryable, [{ field: "nope", op: "eq", value: 1 }])).toThrow(/"nope" is not a queryable field/);
  });

  describe("`{ or: [...] }` groups", () => {
    it("OR-joins a group's own conditions, parenthesized, ANDed with sibling entries", () => {
      const where: EntryWhere = [
        { field: "views", op: "gte", value: 10 },
        { or: [{ field: "category", op: "eq", value: 1 }, { field: "category", op: "eq", value: 2 }] },
      ];
      const result = buildWhereClause(queryable, where);
      expect(result?.sql).toBe('"views" >= ? AND ("category" = ? OR "category" = ?)');
      expect(result?.params).toEqual([10, 1, 2]);
    });

    it("supports a where made up of only an OR group", () => {
      const where: EntryWhere = [{ or: [{ field: "category", op: "eq", value: 1 }, { field: "category", op: "eq", value: 2 }] }];
      const result = buildWhereClause(queryable, where);
      expect(result?.sql).toBe('("category" = ? OR "category" = ?)');
      expect(result?.params).toEqual([1, 2]);
    });

    it("treats an empty OR group as unconditionally false, same as an empty `in`", () => {
      const result = buildWhereClause(queryable, [{ or: [] }]);
      expect(result?.sql).toBe("0");
      expect(result?.params).toEqual([]);
    });

    it("ANDs multiple OR groups together", () => {
      const where: EntryWhere = [
        { or: [{ field: "category", op: "eq", value: 1 }, { field: "category", op: "eq", value: 2 }] },
        { or: [{ field: "views", op: "eq", value: 0 }, { field: "views", op: "gte", value: 100 }] },
      ];
      const result = buildWhereClause(queryable, where);
      expect(result?.sql).toBe('("category" = ? OR "category" = ?) AND ("views" = ? OR "views" >= ?)');
      expect(result?.params).toEqual([1, 2, 0, 100]);
    });

    it("throws EntryWhereError when a condition inside a group targets an unqueryable field", () => {
      const where: EntryWhere = [{ or: [{ field: "nope", op: "eq", value: 1 }] }];
      expect(() => buildWhereClause(queryable, where)).toThrow(EntryWhereError);
    });
  });
});
