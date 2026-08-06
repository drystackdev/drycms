import { describe, expect, it } from "vitest";
import { mergeSeoLayers, seoTierFor } from "./dry-seo.js";
import { SEO_DEFAULTS_TYPE_ID } from "./system-fields.js";
import type { ContentTypeDefinition } from "./types.js";

function contentType(overrides: Partial<ContentTypeDefinition>): ContentTypeDefinition {
  return {
    id: "t-id",
    kind: "collection",
    name: "thing",
    label: "Thing",
    fields: [],
    version: 0,
    ...overrides,
  };
}

describe("seoTierFor", () => {
  it("is null when features.seo is off, regardless of kind", () => {
    expect(seoTierFor(contentType({ kind: "collection" }))).toBeNull();
    expect(seoTierFor(contentType({ kind: "singleton" }))).toBeNull();
  });

  it("is 'entry' for a collection with features.seo", () => {
    expect(seoTierFor(contentType({ kind: "collection", features: { seo: true } }))).toBe("entry");
  });

  it("is 'singleton' for any other SEO-enabled singleton", () => {
    expect(seoTierFor(contentType({ kind: "singleton", features: { seo: true } }))).toBe("singleton");
  });

  it("is 'default' for the built-in seoDefaults singleton specifically (matched by id, not name)", () => {
    expect(
      seoTierFor(contentType({ id: SEO_DEFAULTS_TYPE_ID, kind: "singleton", features: { seo: true } })),
    ).toBe("default");
    // Renaming it (still allowed - only `locked`, not `frozen`, see `seed.ts`)
    // doesn't break the cascade, since the id is what's checked.
    expect(
      seoTierFor(contentType({ id: SEO_DEFAULTS_TYPE_ID, name: "renamedSeoDefaults", kind: "singleton", features: { seo: true } })),
    ).toBe("default");
  });

  it("is null for a component, even with features.seo somehow set", () => {
    expect(seoTierFor(contentType({ kind: "component", features: { seo: true } }))).toBeNull();
  });
});

describe("mergeSeoLayers", () => {
  it("is empty when no layer is set", () => {
    expect(mergeSeoLayers(undefined)).toEqual({});
    expect(mergeSeoLayers({})).toEqual({});
  });

  it("applies Default < Singleton < Entry priority, field by field", () => {
    const merged = mergeSeoLayers({
      default: { metaTitle: "Default title", description: "Default description", image: "default.jpg" },
      singleton: { metaTitle: "Singleton title" },
      entry: { description: "Entry description" },
    });
    // Entry's description wins; Singleton's metaTitle wins over Default's
    // (Entry never set one); Default's image survives untouched (neither
    // higher layer set one).
    expect(merged).toEqual({
      metaTitle: "Singleton title",
      description: "Entry description",
      image: "default.jpg",
    });
  });

  it("doesn't let a layer's unset field (explicit null, per entry-codec.ts's rowToValue) blank out a lower layer's value", () => {
    const merged = mergeSeoLayers({
      default: { metaTitle: "Default title", description: "Default description", image: "default.jpg" },
      entry: { metaTitle: "Entry title", description: null as never, image: null as never },
    });
    expect(merged).toEqual({
      metaTitle: "Entry title",
      description: "Default description",
      image: "default.jpg",
    });
  });

  it("ignores an empty-string field the same way as unset", () => {
    const merged = mergeSeoLayers({
      default: { metaTitle: "Default title" },
      entry: { metaTitle: "" },
    });
    expect(merged.metaTitle).toBe("Default title");
  });

  it("lets the 'page' layer (setTitle()) override every other layer, including entry", () => {
    const merged = mergeSeoLayers({
      default: { metaTitle: "Default title", description: "Default description" },
      singleton: { metaTitle: "Singleton title" },
      entry: { metaTitle: "Entry title" },
      page: { metaTitle: "setTitle() wins" },
    });
    expect(merged.metaTitle).toBe("setTitle() wins");
    // Only the field the page layer actually set is overridden.
    expect(merged.description).toBe("Default description");
  });
});
