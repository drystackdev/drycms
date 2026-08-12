import { describe, expect, it } from "vitest";
import { demoContentTypes, demoEntries, demoPageSources, DEMO_TYPE_IDS } from "./demo-seed.js";
import { fieldTypes } from "./field-registry.js";
import { validateContentTypeName, validateFieldName } from "./naming.js";
import { PAGES_SOURCE_ROOTS } from "../server/app-router/source-roots.js";
import { validateEntryValue } from "./engine/entry-codec.js";
import { buildEntryFieldTree } from "./engine/entry-tree.js";

const types = demoContentTypes();
const byId = new Map(types.map((type) => [type.id, type]));

describe("demoContentTypes", () => {
  it("only uses field types the registry actually knows", () => {
    for (const type of types) {
      for (const field of type.fields) {
        expect(fieldTypes[field.type], `${type.name}.${field.name} (${field.type})`).toBeDefined();
      }
    }
  });

  it("points every relation/component field at another demo type", () => {
    for (const type of types) {
      for (const field of type.fields) {
        const target = field.type === "relation" ? field.config.target : field.type === "component" ? field.config.componentId : undefined;
        if (target === undefined) continue;
        expect(byId.get(String(target)), `${type.name}.${field.name} -> ${String(target)}`).toBeDefined();
      }
    }
  });

  it("is ordered so every target type is defined before whatever points at it", () => {
    // The pusher walks this array front to back and saves as it goes - a
    // relation whose target doesn't exist yet is rejected by the schema API.
    const defined = new Set<string>();
    for (const type of types) {
      for (const field of type.fields) {
        const target = field.type === "relation" ? field.config.target : field.type === "component" ? field.config.componentId : undefined;
        if (target !== undefined) expect(defined.has(String(target)), `${type.name}.${field.name}`).toBe(true);
      }
      defined.add(type.id);
    }
  });

  it("never names a field or type something the engine reserves", () => {
    // The schema API rejects these outright (`naming.ts`), so a seed using
    // one fails at the very first push - caught here instead of live.
    for (const type of types) {
      // Against the OTHER types, the way the API checks a name when saving
      // this one - passing the full list would trip its own uniqueness rule.
      expect(() => validateContentTypeName(type.name, types.filter((other) => other.id !== type.id))).not.toThrow();
      for (const field of type.fields) {
        expect(() => validateFieldName(field.name), `${type.name}.${field.name}`).not.toThrow();
      }
    }
  });

  it("keeps ids and names unique and stable, so re-seeding updates in place", () => {
    expect(new Set(types.map((t) => t.id)).size).toBe(types.length);
    expect(new Set(types.map((t) => t.name)).size).toBe(types.length);
    // A second call must be deep-equal - anything randomized here would make
    // the seed non-idempotent.
    expect(demoContentTypes()).toEqual(types);
  });
});

describe("demoEntries", () => {
  const entries = demoEntries();

  it("belongs to a demo type and passes that type's own field validation", () => {
    for (const entry of entries) {
      const type = byId.get(entry.typeId);
      expect(type, entry.typeId).toBeDefined();
      const nodes = buildEntryFieldTree(type!, types);
      // Relations are resolved by the pusher, not carried in `value` - fill
      // in a placeholder id per named relation so `required`/shape checks see
      // the row the way it will actually be submitted.
      const value = { ...entry.value };
      for (const [fieldName, targets] of Object.entries(entry.relations ?? {})) {
        const field = type!.fields.find((f) => f.name === fieldName);
        value[fieldName] = field?.config.cardinality === "manyToOne" ? 1 : targets.map((_, index) => index + 1);
      }
      expect(validateEntryValue(nodes, value), `${type!.name}/${entry.slug ?? "singleton"}`).toEqual({});
    }
  });

  it("only names relation fields that exist on the row's own type, targeting a seeded slug", () => {
    const slugsByType = new Map<string, Set<string>>();
    for (const entry of entries) {
      if (!entry.slug) continue;
      const set = slugsByType.get(entry.typeId) ?? new Set<string>();
      set.add(entry.slug);
      slugsByType.set(entry.typeId, set);
    }

    for (const entry of entries) {
      const type = byId.get(entry.typeId)!;
      for (const [fieldName, targets] of Object.entries(entry.relations ?? {})) {
        const field = type.fields.find((f) => f.name === fieldName);
        expect(field?.type, `${type.name}.${fieldName}`).toBe("relation");
        for (const slug of targets) {
          expect(slugsByType.get(String(field!.config.target))?.has(slug), `${type.name}.${fieldName} -> ${slug}`).toBe(true);
        }
      }
    }
  });

  it("creates a relation's target rows before the rows pointing at them", () => {
    const created = new Set<string>();
    for (const entry of entries) {
      const type = byId.get(entry.typeId)!;
      for (const [fieldName, targets] of Object.entries(entry.relations ?? {})) {
        const field = type.fields.find((f) => f.name === fieldName)!;
        for (const slug of targets) expect(created.has(`${String(field.config.target)}:${slug}`)).toBe(true);
      }
      if (entry.slug) created.add(`${entry.typeId}:${entry.slug}`);
    }
  });

  it("gives every slugged collection row a slug, and the singleton none", () => {
    for (const entry of entries) {
      const type = byId.get(entry.typeId)!;
      if (type.kind === "singleton") expect(entry.slug).toBeUndefined();
      else expect(entry.slug, type.name).toBeTruthy();
    }
    expect(entries.filter((e) => e.typeId === DEMO_TYPE_IDS.landing)).toHaveLength(1);
  });
});

describe("demoPageSources", () => {
  const sources = demoPageSources();
  const rootIds = new Set(PAGES_SOURCE_ROOTS.map((root) => root.id));

  it("writes every file under a real source root, at a unique path", () => {
    for (const { path } of sources) {
      expect(rootIds.has(path.split("/")[0]!), path).toBe(true);
      expect(path.endsWith(".tsx"), path).toBe(true);
    }
    expect(new Set(sources.map((s) => s.path)).size).toBe(sources.length);
  });

  it("ships the /demo route the seeded content is for, plus its detail page", () => {
    const paths = sources.map((s) => s.path);
    expect(paths).toContain("pages/demo/page.tsx");
    expect(paths).toContain("pages/demo/[slug]/page.tsx");
  });

  it("only imports @component files it also seeds", () => {
    const componentPaths = new Set(sources.map((s) => s.path));
    for (const { path, source } of sources) {
      for (const match of source.matchAll(/from "@component\/([^"]+)"/g)) {
        expect(componentPaths.has(`component/${match[1]}.tsx`), `${path} -> ${match[1]}`).toBe(true);
      }
    }
  });

  it("reads only content types the seed actually creates", () => {
    const names = new Set(types.map((type) => type.name));
    for (const { path, source } of sources) {
      for (const match of source.matchAll(/\.(?:collection|singleton)\("([^"]+)"\)/g)) {
        expect(names.has(match[1]!), `${path} -> ${match[1]}`).toBe(true);
      }
    }
  });
});
