export const prerender = false;

import type { APIContext, APIRoute } from "astro";
import { content } from "virtual:drycms/content-config";
import { createContentEngineAdapter } from "../content-types/engine/index.js";
import { ContentEngineError, type ContentEngineAdapter } from "../content-types/engine/types.js";
import type { SavePlan } from "../content-types/migration.js";
import { NamingError, validateContentTypeDefinition } from "../content-types/naming.js";
import { collectTableNames, resolveTableTree } from "../content-types/tree.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { randomUUID } from "../lib/uuid.js";

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
 * `sqlite` is cheap and safe to share across requests (a single open
 * connection, module-cached exactly like `routes/storage.ts`'s adapter).
 * `D1` cannot be: its live binding only exists per-request
 * (`context.locals.runtime.env`), so that branch is constructed fresh on
 * every call instead - see `ResolvedD1ContentOption`'s docs.
 */
const moduleAdapter: ContentEngineAdapter | undefined = content.engine === "sqlite" ? createContentEngineAdapter(content) : undefined;

function getAdapter(context: APIContext): ContentEngineAdapter {
  if (moduleAdapter) return moduleAdapter;
  const runtimeEnv = (context.locals as { runtime?: { env?: Record<string, unknown> } }).runtime?.env;
  return createContentEngineAdapter(content, runtimeEnv);
}

function readId(context: APIContext): string | undefined {
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
  definition: ContentTypeDefinition,
  confirm: boolean,
): Promise<Response> {
  const allTypes = await adapter.listContentTypes();
  validateContentTypeDefinition(definition, allTypes);

  // `validateContentTypeDefinition` only rules out two types sharing a
  // top-level *name* - it can't see that a repeatable field's generated
  // child table (e.g. "posts_categories") might collide with some OTHER
  // type's table name, since that's a property of the resolved tree, not
  // the definition itself. Components never produce tables of their own.
  if (definition.kind !== "component") {
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

  const plan: SavePlan = await adapter.planSave(definition);
  if (plan.destructiveSummary.length > 0 && !confirm) {
    return jsonResponse({ requiresConfirm: true, destructiveSummary: plan.destructiveSummary });
  }

  const saved = await adapter.applySave(definition, plan);
  return jsonResponse({ definition: saved }, 200);
}

export const GET: APIRoute = async (context) => {
  try {
    const adapter = getAdapter(context);
    const id = readId(context);
    if (id) {
      const definition = await adapter.getContentType(id);
      if (!definition) throw new ContentEngineError("not_found", `Content type "${id}" not found.`);
      return jsonResponse({ definition });
    }
    const definitions = await adapter.listContentTypes();
    return jsonResponse({ definitions });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const adapter = getAdapter(context);
    const raw = (await context.request.json()) as Partial<SaveRequestBody>;
    if (!raw.definition) throw new ContentEngineError("invalid_definition", "Request body must include `definition`.");

    const definition: ContentTypeDefinition = {
      ...raw.definition,
      id: raw.definition.id || randomUUID(),
      version: 0,
    };
    return await handleSave(adapter, definition, raw.confirm === true);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PUT: APIRoute = async (context) => {
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
    return await handleSave(adapter, definition, raw.confirm === true);
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: APIRoute = async (context) => {
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
