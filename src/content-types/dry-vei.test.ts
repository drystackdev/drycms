import { describe, expect, it } from "vitest";
import {
  boxRecordStrings,
  boxString,
  createRefProxy,
  decodeRef,
  decodeRefs,
  dryBind,
  encodeRef,
  fieldTypeAt,
  normalizePath,
  refOf,
  unbox,
  type DryRef,
} from "./dry-vei.js";
import type { ContentTypeDefinition } from "./types.js";

function field(partial: Partial<ContentTypeDefinition["fields"][number]> & { id: string; name: string; type: string }): ContentTypeDefinition["fields"][number] {
  return { label: partial.name, config: {}, validation: {}, order: 0, ...partial };
}

const hero: ContentTypeDefinition = {
  id: "hero",
  kind: "component",
  name: "hero",
  label: "Hero",
  version: 0,
  fields: [field({ id: "h1", name: "name", type: "text" }), field({ id: "h2", name: "note", type: "text" })],
};

const blog: ContentTypeDefinition = {
  id: "blog",
  kind: "collection",
  name: "blog",
  label: "Blog",
  version: 0,
  fields: [
    field({ id: "f1", name: "title", type: "text" }),
    field({ id: "f2", name: "hero", type: "component", config: { componentId: "hero", repeatable: false } }),
    field({ id: "f3", name: "blocks", type: "component", config: { componentId: "hero", repeatable: true } }),
  ],
};

const allTypes = [blog, hero];
const ref: DryRef = { kind: "collection", type: "blog", id: 12, path: "hero.name", fieldType: "text" };

describe("encodeRef/decodeRef", () => {
  it("round-trips a collection ref", () => {
    expect(encodeRef(ref)).toBe("c:blog:12:hero.name:text");
    expect(decodeRef(encodeRef(ref))).toEqual(ref);
  });

  it("round-trips a singleton ref", () => {
    const settings: DryRef = { kind: "singleton", type: "settings", id: 1, path: "title", fieldType: "text" };
    expect(encodeRef(settings)).toBe("s:settings:1:title:text");
    expect(decodeRef(encodeRef(settings))).toEqual(settings);
  });

  it("round-trips a repeatable item path", () => {
    const item: DryRef = { kind: "collection", type: "blog", id: 3, path: "blocks.2.name", fieldType: "text" };
    expect(decodeRef(encodeRef(item))).toEqual(item);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(decodeRef("")).toBeNull();
    expect(decodeRef("c:blog:12:title")).toBeNull();
    expect(decodeRef("x:blog:12:title:text")).toBeNull();
    expect(decodeRef("c:blog:abc:title:text")).toBeNull();
  });

  it("skips a malformed entry in a multi-ref attribute instead of dropping all of them", () => {
    expect(decodeRefs("c:blog:12:title:text nonsense s:settings:1:title:text")).toHaveLength(2);
    expect(decodeRefs(null)).toEqual([]);
  });
});

describe("boxString", () => {
  it("keeps the value usable as a string", () => {
    const boxed = boxString("Xin chào", ref);
    expect(`${boxed}`).toBe("Xin chào");
    expect(boxed.length).toBe(8);
    expect(String(boxed)).toBe("Xin chào");
  });

  it("carries the ref, and `unbox` gives back a real primitive", () => {
    const boxed = boxString("a", ref);
    expect(refOf(boxed)).toEqual(ref);
    expect(typeof boxed).toBe("object");
    expect(typeof unbox(boxed)).toBe("string");
    expect(refOf("a")).toBeNull();
    expect(refOf(null)).toBeNull();
    expect(refOf(42)).toBeNull();
  });

  it("survives JSON as a plain string, so a boxed value never leaks its ref into the replay log", () => {
    expect(JSON.stringify({ title: boxString("a", ref) })).toBe('{"title":"a"}');
  });
});

describe("fieldTypeAt", () => {
  it("resolves a top-level field", () => {
    expect(fieldTypeAt(blog, allTypes, "title")).toBe("text");
  });

  it("resolves a field inside a non-repeatable component", () => {
    expect(fieldTypeAt(blog, allTypes, "hero.name")).toBe("text");
    expect(fieldTypeAt(blog, allTypes, "hero.note")).toBe("text");
  });

  it("resolves a field inside a repeatable component regardless of index", () => {
    expect(fieldTypeAt(blog, allTypes, "blocks.0.name")).toBe("text");
    expect(fieldTypeAt(blog, allTypes, "blocks.17.name")).toBe("text");
  });

  it("returns null for a path that isn't a field", () => {
    expect(fieldTypeAt(blog, allTypes, "nope")).toBeNull();
    expect(fieldTypeAt(blog, allTypes, "hero.nope")).toBeNull();
  });

  it("normalizes only numeric segments", () => {
    expect(normalizePath("blocks.2.title")).toBe("blocks.*.title");
    expect(normalizePath("hero.name")).toBe("hero.name");
  });
});

describe("createRefProxy", () => {
  const target = { kind: "collection" as const, type: blog, allTypes, id: 7 };

  it("builds a ref from a top-level property access", () => {
    expect(refOf(createRefProxy(target).title)).toEqual({ kind: "collection", type: "blog", id: 7, path: "title", fieldType: "text" });
  });

  it("builds a ref from a nested access", () => {
    const $ = createRefProxy(target) as { hero: { name: unknown } };
    expect(refOf($.hero.name)).toEqual({ kind: "collection", type: "blog", id: 7, path: "hero.name", fieldType: "text" });
  });

  it("builds a ref through a repeatable index", () => {
    const $ = createRefProxy(target) as unknown as { blocks: Record<number, { name: unknown }> };
    expect(refOf($.blocks[2].name)).toEqual({ kind: "collection", type: "blog", id: 7, path: "blocks.2.name", fieldType: "text" });
  });

  it("resolves to null for a path with no matching field", () => {
    const $ = createRefProxy(target) as { nope: unknown };
    expect(refOf($.nope)).toBeNull();
  });
});

describe("boxRecordStrings", () => {
  const target = { kind: "collection" as const, type: blog, allTypes, id: 7 };

  it("boxes a top-level editable string with its own ref", () => {
    const record = boxRecordStrings({ id: 7, title: "Xin chào" }, target);
    expect(`${record.title}`).toBe("Xin chào");
    expect(refOf(record.title)).toEqual({ kind: "collection", type: "blog", id: 7, path: "title", fieldType: "text" });
  });

  it("never boxes the id - it goes back into `where` clauses as a real number", () => {
    const record = boxRecordStrings({ id: 7, title: "a" }, target);
    expect(typeof record.id).toBe("number");
    expect(refOf(record.id)).toBeNull();
  });

  it("reaches into a component", () => {
    const record = boxRecordStrings({ id: 7, hero: { name: "Tên" } }, target);
    const hero = record.hero as Record<string, unknown>;
    expect(refOf(hero.name)?.path).toBe("hero.name");
  });

  it("reaches into a repeatable component, keeping each item's index", () => {
    const record = boxRecordStrings({ id: 7, blocks: [{ name: "một" }, { name: "hai" }] }, target);
    const blocks = record.blocks as Record<string, unknown>[];
    expect(refOf(blocks[0]!.name)?.path).toBe("blocks.0.name");
    expect(refOf(blocks[1]!.name)?.path).toBe("blocks.1.name");
    expect(`${blocks[1]!.name}`).toBe("hai");
  });

  it("leaves a value alone when its path isn't an editable field", () => {
    const record = boxRecordStrings({ id: 7, unknownField: "x", hero: { nope: "y" } }, target);
    expect(refOf(record.unknownField)).toBeNull();
    expect(typeof record.unknownField).toBe("string");
  });

  it("skips a key named in skipKeys, so a select transform's derived value is never offered for inline editing", () => {
    // `title` IS an editable field here (the case right above boxes it) - it
    // stays a plain string only because the caller asked for it to.
    const record = boxRecordStrings({ id: 7, title: "Tóm tắt..." }, target, new Set(["title"]));
    expect(refOf(record.title)).toBeNull();
    expect(typeof record.title).toBe("string");
  });

  it("leaves non-string values untouched, including dates", () => {
    const date = new Date("2026-08-05");
    const record = boxRecordStrings({ id: 7, date, views: 3, featured: false }, target);
    expect(record.date).toBe(date);
    expect(record.views).toBe(3);
    expect(record.featured).toBe(false);
  });
});

describe("dryBind", () => {
  it("marks text from a ref", () => {
    const $ = createRefProxy({ kind: "collection", type: blog, allTypes, id: 7 }) as { title: unknown };
    expect(dryBind($.title)).toEqual({ "data-dry": "c:blog:7:title:text" });
  });

  it("marks an attribute when told which one", () => {
    const $ = createRefProxy({ kind: "collection", type: blog, allTypes, id: 7 }) as { title: unknown };
    expect(dryBind($.title, "src")).toEqual({ "data-dry-src": "c:blog:7:title:text" });
  });

  it("accepts an already-boxed value, not just a ref", () => {
    expect(dryBind(boxString("a", ref))).toEqual({ "data-dry": "c:blog:12:hero.name:text" });
  });

  it("yields no attribute at all when the ref can't be resolved", () => {
    expect(dryBind("plain string")).toEqual({});
    expect(dryBind(undefined)).toEqual({});
  });
});
