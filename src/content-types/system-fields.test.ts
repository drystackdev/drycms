import { describe, expect, it } from "vitest";
import {
  activeFields,
  activeSystemFieldsFor,
  defaultFieldSide,
  effectiveFeatures,
  relationMirrorFieldsFor,
  resolveFieldSide,
  SYSTEM_COMPONENT_IDS,
  SYSTEM_FIELD_IDS,
  systemFieldsFor,
} from "./system-fields.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

function contentType(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "t1", kind: "collection", name: "blog", label: "Blog", fields: [], version: 0, ...overrides };
}

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "f1",
    name: "price",
    label: "Price",
    type: "number",
    config: {},
    validation: {},
    order: 0,
    ...overrides,
  };
}

describe("systemFieldsFor", () => {
  it("adds no title/slug when the slug feature is off", () => {
    const fields = systemFieldsFor(contentType({ features: {} }));
    expect(fields.map((f) => f.id)).not.toContain(SYSTEM_FIELD_IDS.title);
    expect(fields.map((f) => f.id)).not.toContain(SYSTEM_FIELD_IDS.slug);
  });

  it("bundles title and slug together, title first, when the slug feature is on", () => {
    const fields = systemFieldsFor(contentType({ features: { slug: true } }));
    const ids = fields.map((f) => f.id);
    expect(ids.indexOf(SYSTEM_FIELD_IDS.title)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(SYSTEM_FIELD_IDS.slug)).toBeGreaterThan(ids.indexOf(SYSTEM_FIELD_IDS.title));
  });

  it("adds createdAt/updatedAt on a collection when timestamps is on", () => {
    const fields = systemFieldsFor(contentType({ features: { timestamps: true } }));
    const ids = fields.map((f) => f.id);
    expect(ids).toContain(SYSTEM_FIELD_IDS.createdAt);
    expect(ids).toContain(SYSTEM_FIELD_IDS.updatedAt);
  });

  it("never adds timestamps on a singleton, even when the flag is set", () => {
    const fields = systemFieldsFor(contentType({ kind: "singleton", features: { timestamps: true } as never }));
    const ids = fields.map((f) => f.id);
    expect(ids).not.toContain(SYSTEM_FIELD_IDS.createdAt);
    expect(ids).not.toContain(SYSTEM_FIELD_IDS.updatedAt);
  });

  it("never adds draft/schedule on a singleton", () => {
    const fields = systemFieldsFor(
      contentType({ kind: "singleton", features: { slug: true, draft: true, schedule: true } as never }),
    );
    const ids = fields.map((f) => f.id);
    expect(ids).not.toContain(SYSTEM_FIELD_IDS.draft);
    expect(ids).not.toContain(SYSTEM_FIELD_IDS.schedule);
  });

  it("adds no seo field when the seo feature is off", () => {
    const fields = systemFieldsFor(contentType({ features: {} }));
    expect(fields.map((f) => f.id)).not.toContain(SYSTEM_FIELD_IDS.seo);
  });

  it("adds a non-repeatable component field embedding the built-in seo component when the seo feature is on", () => {
    const fields = systemFieldsFor(contentType({ features: { seo: true } }));
    const seoField = fields.find((f) => f.id === SYSTEM_FIELD_IDS.seo);
    expect(seoField).toMatchObject({
      name: "seo",
      type: "component",
      config: { componentId: SYSTEM_COMPONENT_IDS.seo, repeatable: false },
    });
  });

  it("adds the seo field on a singleton too, unlike draft/schedule/timestamps", () => {
    const fields = systemFieldsFor(contentType({ kind: "singleton", features: { seo: true } as never }));
    expect(fields.map((f) => f.id)).toContain(SYSTEM_FIELD_IDS.seo);
  });

  it("adds no sortIndex field when the sortable feature is off", () => {
    const fields = systemFieldsFor(contentType({ features: {} }));
    expect(fields.map((f) => f.id)).not.toContain(SYSTEM_FIELD_IDS.sortIndex);
  });

  it("adds a sortIndex number field when the sortable feature is on", () => {
    const fields = systemFieldsFor(contentType({ features: { sortable: true } }));
    const sortField = fields.find((f) => f.id === SYSTEM_FIELD_IDS.sortIndex);
    expect(sortField).toMatchObject({ name: "sortIndex", type: "number" });
  });

  it("never adds sortIndex on a singleton, even when the flag is set", () => {
    const fields = systemFieldsFor(contentType({ kind: "singleton", features: { sortable: true } as never }));
    expect(fields.map((f) => f.id)).not.toContain(SYSTEM_FIELD_IDS.sortIndex);
  });
});

describe("activeFields", () => {
  it("returns every field unchanged when nothing is trashed", () => {
    const f1 = field({ id: "f1" });
    const f2 = field({ id: "f2" });
    expect(activeFields(contentType({ fields: [f1, f2] }))).toEqual([f1, f2]);
  });

  it("hides a field whose id is in deletedFieldIds, without mutating fields[]", () => {
    const f1 = field({ id: "f1" });
    const f2 = field({ id: "f2" });
    const type = contentType({ fields: [f1, f2], deletedFieldIds: ["f1"] });
    expect(activeFields(type)).toEqual([f2]);
    expect(type.fields).toEqual([f1, f2]);
  });
});

describe("effectiveFeatures", () => {
  it("returns features unchanged when nothing is trashed", () => {
    expect(effectiveFeatures(contentType({ features: { draft: true, seo: true } }))).toEqual({
      draft: true,
      seo: true,
    });
  });

  it("forces a trashed key to false without touching the real features object", () => {
    const type = contentType({ features: { draft: true, seo: true }, deletedFeatureKeys: ["draft"] });
    expect(effectiveFeatures(type)).toEqual({ draft: false, seo: true });
    expect(type.features).toEqual({ draft: true, seo: true });
  });
});

describe("activeSystemFieldsFor", () => {
  it("omits the system field(s) for a trashed feature, even though features[key] is still true", () => {
    const type = contentType({ features: { draft: true }, deletedFeatureKeys: ["draft"] });
    expect(activeSystemFieldsFor(type).map((f) => f.id)).not.toContain(SYSTEM_FIELD_IDS.draft);
    // The real systemFieldsFor (used for DDL generation) still sees it as on.
    expect(systemFieldsFor(type).map((f) => f.id)).toContain(SYSTEM_FIELD_IDS.draft);
  });
});

describe("relationMirrorFieldsFor", () => {
  it("skips a relation field that's been trashed on the source type", () => {
    const target = contentType({ id: "target", name: "author" });
    const relationField = field({
      id: "rel1",
      type: "relation",
      config: { target: "target", cardinality: "manyToOne" },
    });
    const source = contentType({
      id: "source",
      name: "post",
      fields: [relationField],
      deletedFieldIds: ["rel1"],
    });
    expect(relationMirrorFieldsFor(target, [target, source])).toEqual([]);
  });

  it("skips a relation field whose source type is hidden (e.g. memory -> user)", () => {
    const target = contentType({ id: "target", name: "user" });
    const relationField = field({
      id: "rel1",
      type: "relation",
      config: { target: "target", cardinality: "manyToOne" },
    });
    const source = contentType({
      id: "source",
      name: "memory",
      fields: [relationField],
      hidden: true,
    });
    expect(relationMirrorFieldsFor(target, [target, source])).toEqual([]);
  });
});

describe("defaultFieldSide", () => {
  it("defaults a relation/component field to the right column", () => {
    expect(defaultFieldSide("custom-1", true)).toBe("right");
  });

  it("defaults draft/schedule/seo to the right column despite being plain columns", () => {
    expect(defaultFieldSide(SYSTEM_FIELD_IDS.draft, false)).toBe("right");
    expect(defaultFieldSide(SYSTEM_FIELD_IDS.schedule, false)).toBe("right");
    expect(defaultFieldSide(SYSTEM_FIELD_IDS.seo, false)).toBe("right");
  });

  it("defaults every other field to the left column", () => {
    expect(defaultFieldSide(SYSTEM_FIELD_IDS.title, false)).toBe("left");
    expect(defaultFieldSide(SYSTEM_FIELD_IDS.slug, false)).toBe("left");
    expect(defaultFieldSide(SYSTEM_FIELD_IDS.createdAt, false)).toBe("left");
    expect(defaultFieldSide("custom-1", false)).toBe("left");
  });
});

describe("resolveFieldSide", () => {
  it("falls back to the computed default when the id is missing from sides", () => {
    expect(resolveFieldSide("custom-1", true, undefined)).toBe("right");
    expect(resolveFieldSide("custom-1", false, {})).toBe("left");
  });

  it("lets an explicit override win over the computed default", () => {
    expect(resolveFieldSide("custom-1", true, { "custom-1": "left" })).toBe("left");
    expect(resolveFieldSide(SYSTEM_FIELD_IDS.draft, false, { [SYSTEM_FIELD_IDS.draft]: "left" })).toBe("left");
  });

  it("ignores a stale override for a since-removed id (self-healing, same as applyFieldOrder)", () => {
    expect(resolveFieldSide("custom-1", false, { "custom-removed": "right" })).toBe("left");
  });
});
