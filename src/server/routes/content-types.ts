import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { content } from "../config.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../content-types/engine/index.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import { ContentEngineError, type AnySavePlan, type ContentEngineAdapter } from "../../content-types/engine/types.js";
import {
  NamingError,
  normalizeFieldOrder,
  validateContentTypeDefinition,
} from "../../content-types/naming.js";
import { collectTableNames, resolveTableTree } from "../../content-types/tree.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { randomUUID } from "../../lib/uuid.js";

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  already_exists: 409,
  version_conflict: 409,
  invalid_definition: 400,
  in_use: 409,
  unsupported: 501,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ContentEngineError) {
    return jsonResponse({ error: error.code, message: error.message }, STATUS_BY_CODE[error.code] ?? 500);
  }
  if (error instanceof NamingError) {
    return jsonResponse({ error: "invalid_definition", message: error.message }, 400);
  }
  return jsonResponse(
    { error: "internal", message: error instanceof Error ? error.message : "Internal error." },
    500,
  );
}

/**
 * `sqlite` and `file` are both cheap and safe to share across requests (a
 * single open connection / a `StorageAdapter` that resolves its own
 * credentials from static config, module-cached exactly like
 * `routes/storage.ts`'s adapter - no local/github/gitlab backend needs a
 * per-request Cloudflare binding). `D1` cannot be: its live binding only
 * exists per-request (`context.env`, the adapter-supplied runtime
 * environment - see `DryRouteContext`), so that branch is constructed fresh
 * on every call instead - see `ResolvedD1ContentOption`'s docs.
 */
const moduleAdapter: ContentEngineAdapter | undefined = content.engine !== "D1" ? createContentEngineAdapter(content) : undefined;
const moduleEntryAdapter: ContentEntryEngineAdapter | undefined =
  content.engine !== "D1" ? createContentEntryEngineAdapter(content) : undefined;

function getAdapter(context: DryRouteContext): ContentEngineAdapter {
  if (moduleAdapter) return moduleAdapter;
  return createContentEngineAdapter(content, context.env);
}

function getEntryAdapter(context: DryRouteContext): ContentEntryEngineAdapter {
  if (moduleEntryAdapter) return moduleEntryAdapter;
  return createContentEntryEngineAdapter(content, context.env);
}

/** The data-version protocol (see `status/build-cache.md`) - `undefined` if
 * the client sent nothing or an unparseable value, which the GET handler
 * treats the same as "no cached version, always send the full payload".
 * Same helper as `routes/content-entries.ts`'s (kept as its own copy - these
 * two routes don't share an adapter type to hang a shared utility off of). */
function parseIfVersion(context: DryRouteContext): number | undefined {
  const header = context.request.headers.get("X-Data-Version");
  if (header === null) return undefined;
  const n = Number(header);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function readId(context: DryRouteContext): string | undefined {
  const raw = context.params.slug as string | undefined;
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ContentEngineError("invalid_definition", "Id contains invalid percent-encoding.");
  }
}

interface SaveRequestBody {
  definition: ContentTypeDefinition;
  confirm?: boolean;
}

/** Shared by POST (create) and PUT (update): validates, plans, and either
 * returns the plan for confirmation (destructive changes pending, caller
 * hasn't confirmed yet) or applies it. */
async function handleSave(
  adapter: ContentEngineAdapter,
  entryAdapter: ContentEntryEngineAdapter,
  definition: ContentTypeDefinition,
  confirm: boolean,
): Promise<Response> {
  definition = normalizeFieldOrder(definition);
  const allTypes = await adapter.listContentTypes();
  validateContentTypeDefinition(definition, allTypes);

  // `validateContentTypeDefinition` only rules out two types sharing a
  // top-level *name* - it can't see that a repeatable field's generated
  // child table (e.g. "posts_categories") might collide with some OTHER
  // type's table name, since that's a property of the resolved tree, not
  // the definition itself. Components never produce tables of their own.
  // SQL/D1 only - the `file` engine never generates a separate physical
  // table for a repeatable component/relation-many field (it nests directly
  // in the owning record's own JSON), so this whole collision class doesn't
  // exist there.
  if (definition.kind !== "component" && content.engine !== "file") {
    const newTableNames = collectTableNames(resolveTableTree(definition, allTypes));
    const others = allTypes.filter((t) => t.id !== definition.id && t.kind !== "component");
    for (const other of others) {
      const otherTableNames = collectTableNames(resolveTableTree(other, allTypes));
      const collision = newTableNames.find((name) => otherTableNames.includes(name));
      if (collision) {
        throw new NamingError(
          `Content type "${definition.name}" would generate table "${collision}", which is already used by "${other.name}".`,
        );
      }
    }
  }

  const plan: AnySavePlan = await adapter.planSave(definition);
  if (plan.destructiveSummary.length > 0 && !confirm) {
    return jsonResponse({ requiresConfirm: true, destructiveSummary: plan.destructiveSummary });
  }

  const saved = await adapter.applySave(definition, plan);

  // A singleton should have something to open and edit the moment it
  // exists, not only after the admin's first manual Save (see
  // `status/role.md`) - a no-op once a row already exists, so safe to run
  // unconditionally on both create and every later schema edit.
  if (saved.kind === "singleton") {
    await entryAdapter.ensureSingletonEntry(saved, await adapter.listContentTypes());
  }

  return jsonResponse({ definition: saved }, 200);
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const adapter = getAdapter(context);

    // Data-version protocol (see `status/build-cache.md`) - the whole
    // content-types collection is one resource, so this check covers both
    // the list AND single-`id` branches below identically to
    // `routes/content-entries.ts`.
    const version = await adapter.getResourceVersion();
    const ifVersion = parseIfVersion(context);
    if (ifVersion !== undefined && ifVersion === version) {
      return jsonResponse({ changed: false, version });
    }

    const id = readId(context);
    if (id) {
      const definition = await adapter.getContentType(id);
      if (!definition) throw new ContentEngineError("not_found", `Content type "${id}" not found.`);
      return jsonResponse({ changed: true, version, definition });
    }
    const definitions = await adapter.listContentTypes();
    return jsonResponse({ changed: true, version, definitions });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: DryRouteHandler = async (context) => {
  try {
    const adapter = getAdapter(context);
    const raw = (await context.request.json()) as Partial<SaveRequestBody>;
    if (!raw.definition) throw new ContentEngineError("invalid_definition", "Request body must include `definition`.");

    const definition: ContentTypeDefinition = {
      ...raw.definition,
      id: raw.definition.id || randomUUID(),
      version: 0,
    };
    return await handleSave(adapter, getEntryAdapter(context), definition, raw.confirm === true);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PUT: DryRouteHandler = async (context) => {
  try {
    const adapter = getAdapter(context);
    const id = readId(context);
    if (!id) throw new ContentEngineError("invalid_definition", "An id is required to update a content type.");

    const raw = (await context.request.json()) as Partial<SaveRequestBody>;
    if (!raw.definition) throw new ContentEngineError("invalid_definition", "Request body must include `definition`.");
    if (raw.definition.id && raw.definition.id !== id) {
      throw new ContentEngineError("invalid_definition", "Request body's `definition.id` doesn't match the URL.");
    }

    const definition: ContentTypeDefinition = { ...raw.definition, id };
    return await handleSave(adapter, getEntryAdapter(context), definition, raw.confirm === true);
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const adapter = getAdapter(context);
    const id = readId(context);
    if (!id) throw new ContentEngineError("invalid_definition", "An id is required to delete a content type.");
    await adapter.deleteContentType(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
