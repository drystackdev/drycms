import { FIELD_TYPE_TS_TYPE, flipCardinality, type ComponentFieldConfig, type FileFieldConfig, type ImageFieldConfig, type RelationCardinality, type RelationFieldConfig, type RelationMirrorFieldConfig, type SelectFieldConfig } from "./field-registry.js";
import { activeFields, activeSystemFieldsFor, applyFieldOrder, relationMirrorFieldsFor } from "./system-fields.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

/** Kebab-case type name (`naming.ts`'s `CONTENT_TYPE_NAME_RE` allows hyphens,
 * unlike a field name) -> a valid TS interface identifier, e.g. `"blog-post"`
 * -> `"BlogPost"`. */
function interfaceName(type: ContentTypeDefinition): string {
  return type.name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * `manyToOne` (this side holds a single, possibly-absent target) -> `number
 * | null`; `oneToMany`/`manyToMany` (this side holds however many links it
 * currently has) -> `number[]`. Matches exactly what `entries-sqlite.ts`/
 * `entries-d1.ts`'s `getEntry`/`findEntry` put in `EntryRow.value` for a
 * relation field TODAY - a raw id or id array, never the target's own data
 * resolved inline (that would need a join/extra query the adapter doesn't do
 * - see `plans/reader.md`'s deferred `populate` option). Emitting the
 * *target's* interface name here instead would overpromise a shape the
 * runtime doesn't actually return.
 */
function relationTsType(cardinality: RelationCardinality): string {
  return cardinality === "manyToOne" ? "number | null" : "number[]";
}

function selectTsType(config: SelectFieldConfig): string {
  const options = config.options ?? [];
  const base = options.length > 0 ? options.map((o) => JSON.stringify(o)).join(" | ") : "string";
  if (!config.multiple) return base;
  // Only a real union (2+ options) needs parens before `[]` - a single
  // literal or the plain `string` fallback is unambiguous either way.
  return options.length > 1 ? `(${base})[]` : `${base}[]`;
}

/**
 * One field's generated interface member, or `null` for a field this
 * codegen deliberately never emits (`password`/`secretkey` - always masked,
 * see `entry-codec.ts`'s `MASKED_FIELD_TYPES`) or can't resolve (a
 * `component`/`relationmirror` pointing at something that no longer exists) -
 * degrades by omitting the field, the same way `entry-tree.ts` degrades a
 * broken reference, rather than throwing and failing the whole file's
 * generation over one bad reference.
 */
function fieldLine(field: FieldDefinition, allTypes: ContentTypeDefinition[], componentsById: Map<string, ContentTypeDefinition>): string | null {
  const optionalMark = field.validation?.required === true ? "" : "?";

  switch (field.type) {
    case "password":
    case "secretkey":
      return null;

    case "relation": {
      const config = field.config as RelationFieldConfig;
      const target = allTypes.find((t) => t.id === config.target);
      const comment = target ? ` // relation -> ${target.name}` : "";
      return `  ${field.name}${optionalMark}: ${relationTsType(config.cardinality)};${comment}`;
    }

    case "relationmirror": {
      const config = field.config as RelationMirrorFieldConfig;
      const sourceType = allTypes.find((t) => t.id === config.sourceTypeId);
      const sourceField = sourceType?.fields.find((f) => f.id === config.sourceFieldId);
      if (!sourceType || !sourceField || sourceField.type !== "relation") return null;
      const reverseCardinality = flipCardinality((sourceField.config as RelationFieldConfig).cardinality);
      return `  ${field.name}${optionalMark}: ${relationTsType(reverseCardinality)}; // relationmirror -> ${sourceType.name}, read-only`;
    }

    case "component": {
      const config = field.config as ComponentFieldConfig;
      const component = componentsById.get(config.componentId);
      if (!component) return null;
      const name = interfaceName(component);
      return `  ${field.name}: ${config.repeatable ? `${name}[]` : name};`;
    }

    case "select":
      return `  ${field.name}${optionalMark}: ${selectTsType(field.config as SelectFieldConfig)};`;

    case "image":
    case "file": {
      const config = field.config as ImageFieldConfig | FileFieldConfig;
      return `  ${field.name}${optionalMark}: ${config.multiple ? "string[]" : "string"};`;
    }

    default: {
      const base = FIELD_TYPE_TS_TYPE[field.type];
      if (!base) return null; // unknown field type - degrade rather than throw.
      return `  ${field.name}${optionalMark}: ${base};`;
    }
  }
}

/** Every active field (custom + system + auto relation-mirrors), in the same
 * display order the schema editor/entry editor show - same three-list
 * concat + `applyFieldOrder` as `entry-tree.ts`'s `buildEntryFieldTree`,
 * minus the physical-column resolution this codegen doesn't need at all
 * (only `field-registry.ts`'s `resolveFieldShape`-implied branching in
 * `fieldLine` above does). */
function orderedFields(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): FieldDefinition[] {
  return applyFieldOrder([...activeFields(type), ...activeSystemFieldsFor(type), ...relationMirrorFieldsFor(type, allTypes)], type.fieldOrder);
}

function generateInterface(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], componentsById: Map<string, ContentTypeDefinition>): string {
  const lines = orderedFields(type, allTypes)
    .map((f) => fieldLine(f, allTypes, componentsById))
    .filter((l): l is string => l !== null);
  // Only `collection`/`singleton` rows have a real, exposed `id` - a
  // (repeatable) component's own child-table row id is never included in
  // `rowToValue`'s output (see `entries-sqlite.ts`'s `populateChildFields`).
  const idLine = type.kind !== "component" ? "  id: number;\n" : "";
  return `export interface ${interfaceName(type)} {\n${idLine}${lines.join("\n")}\n}`;
}

function relationsInterfaceName(type: ContentTypeDefinition): string {
  return `${interfaceName(type)}Relations`;
}

/**
 * The populated shape of one `relation`/`relationmirror` field - the
 * counterpart to `fieldLine`'s raw-id `relationTsType`, used to build the
 * `<Type>Relations` interface `dry-reader.ts`'s `get(id, { populate })`
 * overload picks from. `null` for every non-relational field (nothing to
 * populate) or an unresolvable target - same degrade-by-omitting rule as
 * `fieldLine`. Never optional (`?`) - `dry-populate.ts` always sets the
 * property, to `null`/`[]` when there's nothing to resolve, once a field is
 * actually requested via `populate`.
 */
function relationsFieldLine(field: FieldDefinition, allTypes: ContentTypeDefinition[]): string | null {
  switch (field.type) {
    case "relation": {
      const config = field.config as RelationFieldConfig;
      const target = allTypes.find((t) => t.id === config.target);
      if (!target) return null;
      const shape = config.cardinality === "manyToOne" ? `${interfaceName(target)} | null` : `${interfaceName(target)}[]`;
      return `  ${field.name}: ${shape};`;
    }

    case "relationmirror": {
      const config = field.config as RelationMirrorFieldConfig;
      const sourceType = allTypes.find((t) => t.id === config.sourceTypeId);
      const sourceField = sourceType?.fields.find((f) => f.id === config.sourceFieldId);
      if (!sourceType || !sourceField || sourceField.type !== "relation") return null;
      const reverseCardinality = flipCardinality((sourceField.config as RelationFieldConfig).cardinality);
      const shape = reverseCardinality === "manyToOne" ? `${interfaceName(sourceType)} | null` : `${interfaceName(sourceType)}[]`;
      return `  ${field.name}: ${shape};`;
    }

    default:
      return null;
  }
}

/** Only ever generated for `collection`/`singleton` types - a `component`
 * has no `dry()` reader of its own to populate through. Emits `{}` (no
 * populatable relation fields) rather than omitting the interface entirely,
 * so `DryCollectionRelationsMap`/`DrySingletonRelationsMap` below always
 * have one entry per type, matching `DryCollectionMap`/`DrySingletonMap`
 * 1:1 - `dry-reader.ts`'s `DryReader<CMap, SMap, CRMap, SRMap>` constrains
 * `CRMap`/`SRMap` to have exactly `CMap`/`SMap`'s keys. */
function generateRelationsInterface(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): string {
  const lines = orderedFields(type, allTypes)
    .map((f) => relationsFieldLine(f, allTypes))
    .filter((l): l is string => l !== null);
  if (lines.length === 0) return `export interface ${relationsInterfaceName(type)} {}`;
  return `export interface ${relationsInterfaceName(type)} {\n${lines.join("\n")}\n}`;
}

/**
 * Pure - no fs, no adapter, no engine import. Takes every
 * `ContentTypeDefinition` (as returned by
 * `ContentEngineAdapter.listContentTypes()`) and renders one `.d.ts`-shaped
 * source string: an interface per `collection`/`singleton`/`component` type,
 * a `<Type>Relations` companion interface per `collection`/`singleton`
 * typing its populatable `relation`/`relationmirror` fields, plus the
 * name->interface maps `dry-reader.ts`'s generic `DryReader<CMap, SMap,
 * CRMap, SRMap>` needs to make `dry().collection("post")` resolve to the
 * real `Post` interface (and its `get(id, { populate })` overload resolve
 * to `PostRelations`). Written to disk by a Node-only caller
 * (`scripts/dry-generate.mjs`) - see `plans/reader.md` for why the actual
 * file write deliberately isn't wired into the (Workers-portable)
 * `routes/content-types.ts` apply flow.
 */
export function generateDryTypes(allTypes: ContentTypeDefinition[]): string {
  const componentsById = new Map(allTypes.filter((t) => t.kind === "component").map((t) => [t.id, t]));
  const collections = allTypes.filter((t) => t.kind === "collection");
  const singletons = allTypes.filter((t) => t.kind === "singleton");
  const components = allTypes.filter((t) => t.kind === "component");

  const interfaces = [...collections, ...singletons, ...components].map((t) => generateInterface(t, allTypes, componentsById)).join("\n\n");
  const relationsInterfaces = [...collections, ...singletons].map((t) => generateRelationsInterface(t, allTypes)).join("\n\n");

  const collectionNameUnion = collections.length > 0 ? collections.map((t) => JSON.stringify(t.name)).join(" | ") : "never";
  const singletonNameUnion = singletons.length > 0 ? singletons.map((t) => JSON.stringify(t.name)).join(" | ") : "never";
  const collectionMap = collections.map((t) => `  ${JSON.stringify(t.name)}: ${interfaceName(t)};`).join("\n");
  const singletonMap = singletons.map((t) => `  ${JSON.stringify(t.name)}: ${interfaceName(t)};`).join("\n");
  const collectionRelationsMap = collections.map((t) => `  ${JSON.stringify(t.name)}: ${relationsInterfaceName(t)};`).join("\n");
  const singletonRelationsMap = singletons.map((t) => `  ${JSON.stringify(t.name)}: ${relationsInterfaceName(t)};`).join("\n");

  return `// Generated by \`src/content-types/codegen.ts\` (\`bun run dry:generate\`, and
// once on dev-server startup) - do not edit by hand. Re-run after changing a
// content type's schema; see plans/reader.md.
//
// Calling the ambient globals \`dry()\`/\`params()\`/\`setTitle()\` below works for
// free in any page-source file -
// \`src/server/app-router/app-router-plugin.ts\` (registered in
// \`vite.config.ts\`) injects the real import automatically. Outside that
// source tree, import them yourself instead:
// \`import { dry } from "../content-types/dry-reader.js"\`,
// \`import { params } from "../content-types/params-reader.js"\`,
// \`import { setTitle } from "../content-types/dry-title.js"\`.

import type { DryReader } from "../src/content-types/dry-reader.js";

${interfaces}

${relationsInterfaces}

export type DryCollectionName = ${collectionNameUnion};
export type DrySingletonName = ${singletonNameUnion};

export interface DryCollectionMap {
${collectionMap}
}

export interface DrySingletonMap {
${singletonMap}
}

export interface DryCollectionRelationsMap {
${collectionRelationsMap}
}

export interface DrySingletonRelationsMap {
${singletonRelationsMap}
}

declare global {
  function dry(): DryReader<DryCollectionMap, DrySingletonMap, DryCollectionRelationsMap, DrySingletonRelationsMap>;
  /** The matched route's dynamic segments - \`[slug]\` -> \`string\`,
   * \`[...path]\` -> \`string[]\`. Same value a page/layout receives as its
   * \`params\` prop, readable from any helper function too. */
  function params(): Record<string, string | string[]>;
  /** Sets this page's \`<title>\`/\`og:title\`, overriding every SEO cascade
   * layer (see \`dry-seo.ts\`). Last call wins. */
  function setTitle(title: string): void;
  /** Marks an element as the editable source of one field, for the Visual
   * Editing Interface (\`plans/vei.md\`):
   * \`<h1 {...dryBind(post.$.title)}>{post.title}</h1>\`, or
   * \`<img {...dryBind(post.$.hero, "src")} src={imageUrl(post.hero)} />\`.
   * Emits nothing at all outside edit mode. */
  function dryBind(value: unknown, attribute?: string): Record<string, string>;
}
`;
}
