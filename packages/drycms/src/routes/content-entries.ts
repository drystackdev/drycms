export const prerender = false;

import type { APIContext, APIRoute } from "astro";
import { content } from "virtual:drycms/content-config";
import type { EntryValue } from "../content-types/engine/entry-codec.js";
import { buildEntryFieldTree, type EntryFieldNode } from "../content-types/engine/entry-tree.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../content-types/engine/index.js";
import { ContentEntryError, type ContentEntryEngineAdapter } from "../content-types/engine/entries-types.js";
import { ContentEngineError, type ContentEngineAdapter } from "../content-types/engine/types.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { decodeEntryId, encodeEntryId } from "../lib/id-hash.js";

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  validation_failed: 422,
  unsupported: 501,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ContentEntryError) {
    return jsonResponse(
      { error: error.code, message: error.message, fieldErrors: error.fieldErrors },
      STATUS_BY_CODE[error.code] ?? 500,
    );
  }
  if (error instanceof ContentEngineError) {
    return jsonResponse({ error: error.code, message: error.message }, 500);
  }
  return jsonResponse(
    { error: "internal", message: error instanceof Error ? error.message : "Internal error." },
    500,
  );
}

/** Same module-cache/fresh-per-request split as `routes/content-types.ts` -
 * one pair of adapters here since this route needs both the schema adapter
 * (to resolve `typeSlug` -> `ContentTypeDefinition`) and the entry adapter
 * (for the actual row CRUD). */
const moduleSchemaAdapter: ContentEngineAdapter | undefined =
  content.engine !== "D1" ? createContentEngineAdapter(content) : undefined;
const moduleEntryAdapter: ContentEntryEngineAdapter | undefined =
  content.engine !== "D1" ? createContentEntryEngineAdapter(content) : undefined;

function runtimeEnvOf(context: APIContext): Record<string, unknown> | undefined {
  return (context.locals as { runtime?: { env?: Record<string, unknown> } }).runtime?.env;
}

function getSchemaAdapter(context: APIContext): ContentEngineAdapter {
  return moduleSchemaAdapter ?? createContentEngineAdapter(content, runtimeEnvOf(context));
}

function getEntryAdapter(context: APIContext): ContentEntryEngineAdapter {
  return moduleEntryAdapter ?? createContentEntryEngineAdapter(content, runtimeEnvOf(context));
}

function parseSlug(context: APIContext): { typeSlug: string; hashedId?: string } {
  const raw = (context.params.slug as string | undefined) ?? "";
  const [typeSlug, hashedId] = raw.split("/").filter(Boolean);
  if (!typeSlug) throw new ContentEntryError("not_found", "A content type is required.");
  return { typeSlug, hashedId };
}

/** `component` types have no table of their own and are never a valid
 * target here (they only ever appear nested inside another type's fields -
 * see `entries-types.ts`'s doc comment). */
async function resolveType(
  context: APIContext,
  typeSlug: string,
): Promise<{ type: ContentTypeDefinition; allTypes: ContentTypeDefinition[] }> {
  const allTypes = await getSchemaAdapter(context).listContentTypes();
  const type = allTypes.find((t) => t.name === typeSlug && t.kind !== "component");
  if (!type) throw new ContentEntryError("not_found", `Content type "${typeSlug}" not found.`);
  return { type, allTypes };
}

function decodeIdOrThrow(hashedId: string): number {
  const id = decodeEntryId(hashedId);
  if (id === null) throw new ContentEntryError("not_found", `Entry "${hashedId}" not found.`);
  return id;
}

/** The data-version protocol (see `status/build-cache.md`) - `undefined` if
 * the client sent nothing or an unparseable value, which the GET handler
 * treats the same as "no cached version, always send the full payload". */
function parseIfVersion(context: APIContext): number | undefined {
  const header = context.request.headers.get("X-Data-Version");
  if (header === null) return undefined;
  const n = Number(header);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** A `relation` field's target id(s) are just as sequentially-guessable as
 * an entry's own `id` - hashed/unhashed here, at the same HTTP boundary,
 * recursing into `flatten`/`component-repeat` fields (which can themselves
 * embed further relations) the same way the rest of this route only ever
 * deals in real integers below this layer. */
function encodeRelationIds(nodes: EntryFieldNode[], value: EntryValue): EntryValue {
  const out: EntryValue = { ...value };
  for (const node of nodes) {
    if (node.kind === "flatten") {
      out[node.fieldName] = encodeRelationIds(node.children, (value[node.fieldName] as EntryValue) ?? {});
    } else if (node.kind === "component-repeat") {
      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as EntryValue[]) : [];
      out[node.fieldName] = items.map((item) => encodeRelationIds(node.itemFields, item));
    } else if (node.kind === "relation") {
      const raw = value[node.fieldName];
      out[node.fieldName] = node.columnName
        ? typeof raw === "number"
          ? encodeEntryId(raw)
          : null
        : Array.isArray(raw)
          ? raw.filter((v): v is number => typeof v === "number").map(encodeEntryId)
          : [];
    } else if (node.kind === "relation-mirror") {
      const raw = value[node.fieldName];
      out[node.fieldName] = !node.resolved
        ? null
        : node.reverseCardinality === "manyToOne"
          ? (typeof raw === "number" ? encodeEntryId(raw) : null)
          : Array.isArray(raw)
            ? raw.filter((v): v is number => typeof v === "number").map(encodeEntryId)
            : [];
    }
  }
  return out;
}

function decodeRelationIds(nodes: EntryFieldNode[], value: EntryValue): EntryValue {
  const out: EntryValue = { ...value };
  for (const node of nodes) {
    if (node.kind === "flatten") {
      out[node.fieldName] = decodeRelationIds(node.children, (value[node.fieldName] as EntryValue) ?? {});
    } else if (node.kind === "component-repeat") {
      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as EntryValue[]) : [];
      out[node.fieldName] = items.map((item) => decodeRelationIds(node.itemFields, item));
    } else if (node.kind === "relation") {
      const raw = value[node.fieldName];
      out[node.fieldName] = node.columnName
        ? typeof raw === "string"
          ? decodeEntryId(raw)
          : null
        : Array.isArray(raw)
          ? raw.map((v) => (typeof v === "string" ? decodeEntryId(v) : null)).filter((v): v is number => v !== null)
          : [];
    } else if (node.kind === "relation-mirror") {
      const raw = value[node.fieldName];
      out[node.fieldName] = !node.resolved
        ? null
        : node.reverseCardinality === "manyToOne"
          ? (typeof raw === "string" ? decodeEntryId(raw) : null)
          : Array.isArray(raw)
            ? raw.map((v) => (typeof v === "string" ? decodeEntryId(v) : null)).filter((v): v is number => v !== null)
            : [];
    }
  }
  return out;
}

export const GET: APIRoute = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    const { type, allTypes } = await resolveType(context, typeSlug);
    const entryAdapter = getEntryAdapter(context);
    const nodes = buildEntryFieldTree(type, allTypes);

    // Data-version protocol (see `status/build-cache.md`, mục 9-11): a
    // client that already has this resource cached sends back the version it
    // last saw via `X-Data-Version`. If it still matches, skip the real
    // query entirely (not just the response body) and tell the client
    // nothing changed; otherwise run the query as normal and include the
    // current version alongside it.
    const version = await entryAdapter.getResourceVersion(type);
    const ifVersion = parseIfVersion(context);
    if (ifVersion !== undefined && ifVersion === version) {
      return jsonResponse({ changed: false, version });
    }

    if (type.kind === "singleton") {
      const row = await entryAdapter.getSingletonEntry(type, allTypes);
      return jsonResponse({
        changed: true,
        version,
        entry: row ? { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } : null,
      });
    }

    if (hashedId) {
      const row = await entryAdapter.getEntry(type, allTypes, decodeIdOrThrow(hashedId));
      if (!row) throw new ContentEntryError("not_found", `Entry "${hashedId}" not found.`);
      return jsonResponse({ changed: true, version, entry: { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } });
    }

    const url = new URL(context.request.url);
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 10);
    const sortField = url.searchParams.get("sortField") ?? undefined;
    const sortDirParam = url.searchParams.get("sortDir");
    const sortDir = sortDirParam === "asc" || sortDirParam === "desc" ? sortDirParam : undefined;
    const search = url.searchParams.get("search") ?? undefined;
    const searchableFieldsParam = url.searchParams.get("searchableFields");
    const searchableFields = searchableFieldsParam ? searchableFieldsParam.split(",").filter(Boolean) : undefined;

    const page1 = await entryAdapter.listEntries(type, allTypes, {
      page,
      pageSize,
      sortField,
      sortDir,
      search,
      searchableFields,
    });
    return jsonResponse({
      changed: true,
      version,
      rows: page1.rows.map((row) => ({ id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) })),
      total: page1.total,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    if (hashedId) throw new ContentEntryError("not_found", "POST doesn't take an id - use PUT to update an existing entry.");
    const { type, allTypes } = await resolveType(context, typeSlug);
    const entryAdapter = getEntryAdapter(context);
    const nodes = buildEntryFieldTree(type, allTypes);
    const value = decodeRelationIds(nodes, (await context.request.json()) as EntryValue);

    const row =
      type.kind === "singleton"
        ? await entryAdapter.saveSingletonEntry(type, allTypes, value)
        : await entryAdapter.createEntry(type, allTypes, value);
    return jsonResponse({ entry: { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PUT: APIRoute = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    const { type, allTypes } = await resolveType(context, typeSlug);
    const entryAdapter = getEntryAdapter(context);
    const nodes = buildEntryFieldTree(type, allTypes);
    const value = decodeRelationIds(nodes, (await context.request.json()) as EntryValue);

    if (type.kind === "singleton") {
      const row = await entryAdapter.saveSingletonEntry(type, allTypes, value);
      return jsonResponse({ entry: { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } });
    }
    if (!hashedId) throw new ContentEntryError("not_found", "An entry id is required to update.");
    const row = await entryAdapter.updateEntry(type, allTypes, decodeIdOrThrow(hashedId), value);
    return jsonResponse({ entry: { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } });
  } catch (error) {
    return errorResponse(error);
  }
};

/**
 * Bulk-persists a `features.sortable` collection's drag-reordered
 * `sortIndex` values - unlike PUT (one entry at a time), this always
 * targets the collection itself, never a single entry id, since the List
 * page's Save action renumbers the whole visible order in one request (see
 * `ContentEntryEngineAdapter.reorderEntries`'s doc comment).
 */
export const PATCH: APIRoute = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    if (hashedId) throw new ContentEntryError("not_found", "PATCH reorders the whole collection - it doesn't take an id.");
    const { type, allTypes } = await resolveType(context, typeSlug);
    if (type.kind !== "collection" || !type.features?.sortable) {
      throw new ContentEntryError("unsupported", `"${typeSlug}" isn't a sortable collection.`);
    }
    const entryAdapter = getEntryAdapter(context);
    const body = (await context.request.json()) as { updates?: { id: string; sortIndex: number }[] };
    const updates = (body.updates ?? []).map((u) => ({ id: decodeIdOrThrow(u.id), sortIndex: u.sortIndex }));
    await entryAdapter.reorderEntries(type, allTypes, updates);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    const { type, allTypes } = await resolveType(context, typeSlug);
    if (type.kind === "singleton") throw new ContentEntryError("unsupported", "A singleton's entry can't be deleted.");
    if (!hashedId) throw new ContentEntryError("not_found", "An entry id is required to delete.");
    const entryAdapter = getEntryAdapter(context);
    await entryAdapter.deleteEntry(type, allTypes, decodeIdOrThrow(hashedId));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
