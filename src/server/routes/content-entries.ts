import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { resolveAccess } from "../../content-types/access.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { buildEntryFieldTree, type EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import { ContentEntryError, type ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import { ContentEngineError } from "../../content-types/engine/types.js";
import type { PermissionAction } from "../../content-types/permissions.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { decodeEntryId, encodeEntryId } from "../../lib/id-hash.js";
import { forbiddenResponse, jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { getContentAdapters } from "../content-adapters.js";
import { RequestBodyLimitError } from "../request-limits.js";

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  validation_failed: 422,
  unsupported: 501,
};

function errorResponse(error: unknown): Response {
  if (error instanceof RequestBodyLimitError) return jsonResponse({ error: "request_too_large", message: "Request body is too large." }, 413);
  if (error instanceof ContentEntryError) {
    return jsonResponse(
      { error: error.code, message: error.message, fieldErrors: error.fieldErrors },
      STATUS_BY_CODE[error.code] ?? 500,
    );
  }
  if (error instanceof ContentEngineError) {
    console.error("[drycms] content engine error", error);
    return jsonResponse({ error: error.code, message: "Internal server error." }, 500);
  }
  console.error("[drycms] content entry error", error);
  return jsonResponse({ error: "internal", message: "Internal server error." }, 500);
}

function parseSlug(context: DryRouteContext): { typeSlug: string; hashedId?: string } {
  const raw = (context.params.slug as string | undefined) ?? "";
  const [typeSlug, hashedId] = raw.split("/").filter(Boolean);
  if (!typeSlug) throw new ContentEntryError("not_found", "A content type is required.");
  return { typeSlug, hashedId };
}

/** `component` types have no table of their own and are never a valid
 * target here (they only ever appear nested inside another type's fields -
 * see `entries-types.ts`'s doc comment). */
async function resolveType(
  context: DryRouteContext,
  typeSlug: string,
): Promise<{ type: ContentTypeDefinition; allTypes: ContentTypeDefinition[] }> {
  const allTypes = await getContentAdapters(context).schema.listContentTypes();
  const type = allTypes.find((t) => t.name === typeSlug && t.kind !== "component");
  if (!type) throw new ContentEntryError("not_found", `Content type "${typeSlug}" not found.`);
  return { type, allTypes };
}

function decodeIdOrThrow(hashedId: string): number {
  const id = decodeEntryId(hashedId);
  if (id === null) throw new ContentEntryError("not_found", `Entry "${hashedId}" not found.`);
  return id;
}

async function superAdminRoleIds(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
): Promise<Set<number>> {
  const roleType = allTypes.find((type) => type.name === "role" && type.kind !== "component");
  if (!roleType) return new Set();
  const page = await entryAdapter.listEntries(roleType, allTypes, { page: 0, pageSize: Number.MAX_SAFE_INTEGER });
  return new Set(
    page.rows
      .filter((row) => row.value.isSuperAdmin === true)
      .map((row) => row.id),
  );
}

function isHiddenEntry(type: ContentTypeDefinition, row: EntryValue, superAdminIds: Set<number>): boolean {
  if (type.name === "role") return row.isSuperAdmin === true;
  if (type.name !== "user" || superAdminIds.size === 0) return false;
  const roleIds = Array.isArray(row.roles) ? row.roles : [];
  return roleIds.some((id) => typeof id === "number" && superAdminIds.has(id));
}

/** Resource-level authorization for one entry-CRUD request - `null` means
 * "proceed", otherwise the 401/403 to return immediately. A singleton
 * collapses every action to `"setting"` (see `permissions.ts`'s
 * `permissionActionsFor`); belt-and-suspenders with `handler.ts`'s central
 * "must have a session at all" gate, which this route's own direct-call
 * unit tests bypass entirely - see `context.ts`'s doc comment on `session`. */
async function checkAccess(
  context: DryRouteContext,
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  type: ContentTypeDefinition,
  action: PermissionAction,
): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const access = await resolveAccess(entryAdapter, allTypes, context.session);
  if (!access) return unauthenticatedResponse();
  if (!access.can(type.id, action)) return forbiddenResponse();
  return null;
}

async function protectSystemMutation(
  context: DryRouteContext,
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  type: ContentTypeDefinition,
  action: "create" | "update" | "delete",
  id?: number,
  value?: EntryValue,
): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const access = await resolveAccess(entryAdapter, allTypes, context.session);
  if (!access) return unauthenticatedResponse();
  if (access.isSuperAdmin) return null;

  if (type.name === "aiKey") {
    return forbiddenResponse("AI credential management is restricted to super administrators.");
  }

  const existing = id === undefined ? null : await entryAdapter.getEntry(type, allTypes, id);
  if (type.name === "role") {
    if (existing?.value.isSuperAdmin === true || value?.isSuperAdmin === true) {
      return forbiddenResponse("The Super Admin role cannot be changed through this API.");
    }
    const protectedTypeIds = new Set(
      allTypes.filter((candidate) => candidate.name === "role" || candidate.name === "user" || candidate.name === "aiKey").map((candidate) => candidate.id),
    );
    const permissions = Array.isArray(value?.permissions) ? value.permissions : [];
    const grantsSensitivePermission = permissions.some((permission) =>
      typeof permission === "string" && (permission.startsWith("system-permission:") || [...protectedTypeIds].some((id) => permission.startsWith(`${id}:`))),
    );
    if (grantsSensitivePermission) {
      return forbiddenResponse("Only a super administrator can grant system-management permissions.");
    }
  }

  if (type.name === "user") {
    const existingRoles = Array.isArray(existing?.value.roles) ? existing.value.roles : [];
    const incomingRoles = Array.isArray(value?.roles) ? value.roles : [];
    if (action === "create" && incomingRoles.length > 0) {
      const roleType = allTypes.find((candidate) => candidate.name === "role");
      if (roleType) {
        const roles = await Promise.all(incomingRoles.filter((roleId): roleId is number => typeof roleId === "number").map((roleId) => entryAdapter.getEntry(roleType, allTypes, roleId)));
        if (roles.some((role) => role?.value.isSuperAdmin === true)) return forbiddenResponse("Only a super administrator can assign the Super Admin role.");
      }
    }
    // Use the stored roles, never a client-supplied role shape, to decide
    // whether the entry being deleted/updated is itself a Super Admin.
    let existingIsSuperAdmin = false;
    if ((action === "delete" || action === "update") && existingRoles.length > 0) {
      const roleType = allTypes.find((candidate) => candidate.name === "role");
      if (roleType) {
        const roles = await Promise.all(existingRoles.filter((roleId): roleId is number => typeof roleId === "number").map((roleId) => entryAdapter.getEntry(roleType, allTypes, roleId)));
        existingIsSuperAdmin = roles.some((role) => role?.value.isSuperAdmin === true);
      }
    }
    if (action === "delete" && existingIsSuperAdmin) {
      return forbiddenResponse("A Super Admin user cannot be deleted by a delegated administrator.");
    }
    if (action === "update" && existingIsSuperAdmin) {
      // Not just roles/credentials - a delegated administrator must not be
      // able to touch a Super Admin account at all (e.g. its email), even
      // when resubmitting the same role list. A Super Admin edits their own
      // account through `auth.ts`'s `update-profile` instead.
      return forbiddenResponse("A Super Admin account cannot be changed by a delegated administrator.");
    }
    if (action === "update" && JSON.stringify(existingRoles) !== JSON.stringify(incomingRoles)) {
      return forbiddenResponse("Only a super administrator can change user roles.");
    }
    if (action === "update" && (typeof value?.password === "string" || typeof value?.secretkey === "string" || (value?.password && typeof value.password === "object" && "new" in value.password))) {
      return forbiddenResponse("Only a super administrator can change credentials through this API.");
    }
  }
  return null;
}

async function assertRelationTargetsExist(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  nodes: EntryFieldNode[],
  value: EntryValue,
  path = "",
): Promise<void> {
  const missing: Record<string, string> = {};
  const checks = new Map<string, { pending: Promise<boolean>; paths: Set<string> }>();
  const check = (fieldPath: string, targetTypeId: string, id: unknown) => {
    if (id === null || id === undefined) return;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      missing[fieldPath] = "Relation target id is invalid.";
      return;
    }
    const targetType = allTypes.find((candidate) => candidate.id === targetTypeId && candidate.kind !== "component");
    if (!targetType) {
      missing[fieldPath] = "Relation target type no longer exists.";
      return;
    }
    const key = `${targetType.id}:${id}`;
    const current = checks.get(key);
    if (current) current.paths.add(fieldPath);
    else checks.set(key, { pending: entryAdapter.getEntry(targetType, allTypes, id).then((row) => row !== null), paths: new Set([fieldPath]) });
  };
  for (const node of nodes) {
    const fieldPath = path ? `${path}.${node.fieldName}` : node.fieldName;
    const nested = value[node.fieldName];
    if (node.kind === "flatten") {
      await assertRelationTargetsExist(entryAdapter, allTypes, node.children, (nested as EntryValue) ?? {}, fieldPath);
    } else if (node.kind === "component-repeat") {
      const items = Array.isArray(nested) ? nested : [];
      for (let index = 0; index < items.length; index++) {
        await assertRelationTargetsExist(entryAdapter, allTypes, node.itemFields, (items[index] as EntryValue) ?? {}, `${fieldPath}[${index}]`);
      }
    } else if (node.kind === "relation") {
      if (node.columnName) check(fieldPath, node.targetTypeId, nested);
      else if (Array.isArray(nested)) for (const id of nested) check(fieldPath, node.targetTypeId, id);
    } else if (node.kind === "relation-mirror" && node.resolved) {
      if (node.reverseCardinality === "manyToOne") check(fieldPath, node.sourceTypeId, nested);
      else if (Array.isArray(nested)) for (const id of nested) check(fieldPath, node.sourceTypeId, id);
    }
  }
  const results = await Promise.all([...checks.values()].map(async ({ pending, paths }) => ({ exists: await pending, paths })));
  for (const { exists, paths } of results) if (!exists) for (const fieldPath of paths) missing[fieldPath] = "Relation target does not exist.";
  if (Object.keys(missing).length > 0) throw new ContentEntryError("validation_failed", "One or more relation targets are invalid.", missing);
}

/** The data-version protocol (see `status/build-cache.md`) - `undefined` if
 * the client sent nothing or an unparseable value, which the GET handler
 * treats the same as "no cached version, always send the full payload". */
function parseIfVersion(context: DryRouteContext): number | undefined {
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

export const GET: DryRouteHandler = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    const { type, allTypes } = await resolveType(context, typeSlug);
    const entryAdapter = getContentAdapters(context).entries;
    const denied = await checkAccess(context, entryAdapter, allTypes, type, type.kind === "singleton" ? "setting" : "view");
    if (denied) return denied;
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
      // Same "hidden entry" rule as the list branch below - a Super Admin's
      // `role`/`user` row must not be fetchable directly by id either, or a
      // delegated administrator who merely has `view` could learn (and then,
      // via `protectSystemMutation`, previously edit) an account the list UI
      // deliberately never shows them.
      const superAdminIds = type.name === "user" ? await superAdminRoleIds(entryAdapter, allTypes) : new Set<number>();
      if (isHiddenEntry(type, row.value, superAdminIds)) {
        throw new ContentEntryError("not_found", `Entry "${hashedId}" not found.`);
      }
      return jsonResponse({ changed: true, version, entry: { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } });
    }

    const url = new URL(context.request.url);
    const rawPage = Number(url.searchParams.get("page"));
    const rawPageSize = Number(url.searchParams.get("pageSize"));
    const page = Number.isSafeInteger(rawPage) && rawPage >= 0 ? Math.min(rawPage, 1_000_000) : 0;
    const pageSize = Number.isSafeInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, 100) : 10;
    const sortField = url.searchParams.get("sortField") ?? undefined;
    const sortDirParam = url.searchParams.get("sortDir");
    const sortDir = sortDirParam === "asc" || sortDirParam === "desc" ? sortDirParam : undefined;
    const search = url.searchParams.get("search")?.slice(0, 200) || undefined;
    const searchableFieldsParam = url.searchParams.get("searchableFields");
    const searchableFields = searchableFieldsParam ? searchableFieldsParam.split(",").filter(Boolean) : undefined;

    const superAdminIds = type.name === "user" ? await superAdminRoleIds(entryAdapter, allTypes) : new Set<number>();
    const hideSpecialEntries = type.name === "role" || type.name === "user";
    const page1 = await entryAdapter.listEntries(type, allTypes, {
      page: hideSpecialEntries ? 0 : page,
      pageSize: hideSpecialEntries ? Number.MAX_SAFE_INTEGER : pageSize,
      sortField,
      sortDir,
      search,
      searchableFields,
    });
    let rows = page1.rows;
    if (type.name === "role") {
      rows = page1.rows.filter((row) => !isHiddenEntry(type, row.value, superAdminIds));
    } else if (type.name === "user" && superAdminIds.size > 0) {
      const filtered = await Promise.all(
        page1.rows.map(async (row) => {
          const full = await entryAdapter.getEntry(type, allTypes, row.id);
          return full && !isHiddenEntry(type, full.value, superAdminIds) ? row : null;
        }),
      );
      rows = filtered.filter((row): row is (typeof page1.rows)[number] => row !== null);
    }
    const pagedRows = hideSpecialEntries
      ? rows.slice(page * pageSize, page * pageSize + pageSize)
      : rows;
    return jsonResponse({
      changed: true,
      version,
      rows: pagedRows.map((row) => ({ id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) })),
      total: hideSpecialEntries ? rows.length : page1.total,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: DryRouteHandler = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    if (hashedId) throw new ContentEntryError("not_found", "POST doesn't take an id - use PUT to update an existing entry.");
    const { type, allTypes } = await resolveType(context, typeSlug);
    const entryAdapter = getContentAdapters(context).entries;
    const denied = await checkAccess(context, entryAdapter, allTypes, type, type.kind === "singleton" ? "setting" : "create");
    if (denied) return denied;
    const nodes = buildEntryFieldTree(type, allTypes);
    const value = decodeRelationIds(nodes, (await context.request.json()) as EntryValue);
    const systemDenied = await protectSystemMutation(context, entryAdapter, allTypes, type, "create", undefined, value);
    if (systemDenied) return systemDenied;
    await assertRelationTargetsExist(entryAdapter, allTypes, nodes, value);

    const row =
      type.kind === "singleton"
        ? await entryAdapter.saveSingletonEntry(type, allTypes, value)
        : await entryAdapter.createEntry(type, allTypes, value);
    return jsonResponse({ entry: { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PUT: DryRouteHandler = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    const { type, allTypes } = await resolveType(context, typeSlug);
    const entryAdapter = getContentAdapters(context).entries;
    const denied = await checkAccess(context, entryAdapter, allTypes, type, type.kind === "singleton" ? "setting" : "update");
    if (denied) return denied;
    const nodes = buildEntryFieldTree(type, allTypes);
    const value = decodeRelationIds(nodes, (await context.request.json()) as EntryValue);

    if (type.kind === "singleton") {
      const systemDenied = await protectSystemMutation(context, entryAdapter, allTypes, type, "update", undefined, value);
      if (systemDenied) return systemDenied;
      await assertRelationTargetsExist(entryAdapter, allTypes, nodes, value);
      const row = await entryAdapter.saveSingletonEntry(type, allTypes, value);
      return jsonResponse({ entry: { id: encodeEntryId(row.id), value: encodeRelationIds(nodes, row.value) } });
    }
    if (!hashedId) throw new ContentEntryError("not_found", "An entry id is required to update.");
    const entryId = decodeIdOrThrow(hashedId);
    const existing = await entryAdapter.getEntry(type, allTypes, entryId);
    const systemDenied = await protectSystemMutation(context, entryAdapter, allTypes, type, "update", entryId, value);
    if (systemDenied) return systemDenied;
    await assertRelationTargetsExist(entryAdapter, allTypes, nodes, value);
    const row = await entryAdapter.updateEntry(type, allTypes, entryId, value);
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
export const PATCH: DryRouteHandler = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    if (hashedId) throw new ContentEntryError("not_found", "PATCH reorders the whole collection - it doesn't take an id.");
    const { type, allTypes } = await resolveType(context, typeSlug);
    if (type.kind !== "collection" || !type.features?.sortable) {
      throw new ContentEntryError("unsupported", `"${typeSlug}" isn't a sortable collection.`);
    }
    const entryAdapter = getContentAdapters(context).entries;
    const denied = await checkAccess(context, entryAdapter, allTypes, type, "update");
    if (denied) return denied;
    const body = (await context.request.json()) as { updates?: { id: string; sortIndex: number }[] };
    if (!Array.isArray(body.updates) || body.updates.length > 500) {
      throw new ContentEntryError("validation_failed", "At most 500 reorder updates are allowed per request.");
    }
    const updates = body.updates.map((u) => {
      if (!u || typeof u.id !== "string" || !Number.isSafeInteger(u.sortIndex)) {
        throw new ContentEntryError("validation_failed", "Each reorder update must contain a valid id and integer sortIndex.");
      }
      return { id: decodeIdOrThrow(u.id), sortIndex: u.sortIndex };
    });
    await entryAdapter.reorderEntries(type, allTypes, updates);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const { typeSlug, hashedId } = parseSlug(context);
    const { type, allTypes } = await resolveType(context, typeSlug);
    if (type.kind === "singleton") throw new ContentEntryError("unsupported", "A singleton's entry can't be deleted.");
    if (!hashedId) throw new ContentEntryError("not_found", "An entry id is required to delete.");
    const entryAdapter = getContentAdapters(context).entries;
    const denied = await checkAccess(context, entryAdapter, allTypes, type, "delete");
    if (denied) return denied;
    const entryId = decodeIdOrThrow(hashedId);
    const systemDenied = await protectSystemMutation(context, entryAdapter, allTypes, type, "delete", entryId);
    if (systemDenied) return systemDenied;
    await entryAdapter.deleteEntry(type, allTypes, entryId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
