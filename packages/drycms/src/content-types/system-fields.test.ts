import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENT_IDS, SYSTEM_FIELD_IDS, systemFieldsFor } from "./system-fields.js";
import type { ContentTypeDefinition } from "./types.js";

function contentType(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "t1", kind: "collection", name: "blog", label: "Blog", fields: [], version: 0, ...overrides };
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
});
