import { FIELD_TYPE_TS_TYPE, type ComponentFieldConfig, type ImageFieldConfig, type RelationCardinality, type RelationFieldConfig, type RelationMirrorFieldConfig, type SelectFieldConfig } from "./field-registry.js";
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

function flipCardinality(cardinality: RelationCardinality): RelationCardinality {
  if (cardinality === "manyToOne") return "oneToMany";
  if (cardinality === "oneToMany") return "manyToOne";
  return "manyToMany";
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

    case "image": {
      const config = field.config as ImageFieldConfig;
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

/**
 * Pure - no fs, no adapter, no engine import. Takes every
 * `ContentTypeDefinition` (as returned by
 * `ContentEngineAdapter.listContentTypes()`) and renders one `.d.ts`-shaped
 * source string: an interface per `collection`/`singleton`/`component` type,
 * plus the name->interface maps `dry-reader.ts`'s generic `DryReader<CMap,
 * SMap>` needs to make `dry().collection("post")` resolve to the real `Post`
 * interface. Written to disk by a Node-only caller
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

  const collectionNameUnion = collections.length > 0 ? collections.map((t) => JSON.stringify(t.name)).join(" | ") : "never";
  const singletonNameUnion = singletons.length > 0 ? singletons.map((t) => JSON.stringify(t.name)).join(" | ") : "never";
  const collectionMap = collections.map((t) => `  ${JSON.stringify(t.name)}: ${interfaceName(t)};`).join("\n");
  const singletonMap = singletons.map((t) => `  ${JSON.stringify(t.name)}: ${interfaceName(t)};`).join("\n");

  return `// Generated by \`src/content-types/codegen.ts\` (\`bun run dry:generate\`, and
// once on dev-server startup) - do not edit by hand. Re-run after changing a
// content type's schema; see plans/reader.md.
//
// Calling the ambient global \`dry()\` below works for free in any file under
// \`src/apps/pages/**\` - \`src/server/app-router/dry-global-plugin.ts\`
// (registered in \`vite.config.ts\`) injects the real import automatically.
// Outside that folder, import it yourself instead:
// \`import { dry } from "../content-types/dry-reader.js"\`.

import type { DryReader } from "../content-types/dry-reader.js";

${interfaces}

export type DryCollectionName = ${collectionNameUnion};
export type DrySingletonName = ${singletonNameUnion};

export interface DryCollectionMap {
${collectionMap}
}

export interface DrySingletonMap {
${singletonMap}
}

declare global {
  function dry(): DryReader<DryCollectionMap, DrySingletonMap>;
}
`;
}
