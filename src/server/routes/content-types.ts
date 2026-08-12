import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import { ContentEngineError, type ContentEngineAdapter } from "../../content-types/engine/types.js";
import type { DestructiveChange, SavePlan } from "../../content-types/migration.js";
import { generateDryTypes } from "../../content-types/codegen.js";
import { writeGeneratedDryTypes } from "../../content-types/types-cache.js";
import {
  assertNotFrozen,
  NamingError,
  normalizeFieldOrder,
  validateContentTypeDefinition,
  validateProtectedFields,
} from "../../content-types/naming.js";
import { collectTableNames, resolveTableTree } from "../../content-types/tree.js";
import type { ContentTypeDefinition, ContentTypeKind } from "../../content-types/types.js";
import { randomUUID } from "../../lib/uuid.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { requirePermission } from "../admin-access.js";
import { CONTENT_TYPES_RESOURCE_ID } from "../../content-types/permissions.js";
import { RequestBodyLimitError } from "../request-limits.js";

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  already_exists: 409,
  version_conflict: 409,
  invalid_definition: 400,
  in_use: 409,
  unsupported: 501,
  protected: 403,
};

export function errorResponse(error: unknown): Response {
  if (error instanceof RequestBodyLimitError) return jsonResponse({ error: "request_too_large", message: "Request body is too large." }, 413);
  if (error instanceof ContentEngineError) {
    return jsonResponse({ error: error.code, message: error.message }, STATUS_BY_CODE[error.code] ?? 500);
  }
  if (error instanceof NamingError) {
    return jsonResponse({ error: "invalid_definition", message: error.message }, 400);
  }
  console.error("[drycms] content type route error", error);
  return jsonResponse({ error: "internal", message: "Internal server error." }, 500);
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

interface SaveResultData {
  requiresConfirm?: true;
  destructiveSummary?: DestructiveChange[];
  definition?: ContentTypeDefinition;
}

/** Core of POST/PUT and of each item in a batch (see `handleBatch` below):
 * validates, plans, and either returns the plan for confirmation (destructive
 * changes pending, caller hasn't confirmed yet), returns the plan for
 * preview only (`dryRun`, never writes), or applies it. */
async function performSave(
  adapter: ContentEngineAdapter,
  entryAdapter: ContentEntryEngineAdapter,
  definition: ContentTypeDefinition,
  confirm: boolean,
  dryRun = false,
): Promise<SaveResultData> {
  definition = normalizeFieldOrder(definition);
  const allTypes = await adapter.listContentTypes();
  const existing = allTypes.find((t) => t.id === definition.id);
  assertNotFrozen(existing);
  validateContentTypeDefinition(definition, allTypes);
  validateProtectedFields(existing, definition);

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
  if (dryRun) {
    return { destructiveSummary: plan.destructiveSummary };
  }
  if (plan.destructiveSummary.length > 0 && !confirm) {
    return { requiresConfirm: true, destructiveSummary: plan.destructiveSummary };
  }

  const saved = await adapter.applySave(definition, plan);

  // A singleton should have something to open and edit the moment it
  // exists, not only after the admin's first manual Save (see
  // `status/role.md`) - a no-op once a row already exists, so safe to run
  // unconditionally on both create and every later schema edit.
  if (saved.kind === "singleton") {
    await entryAdapter.ensureSingletonEntry(saved, await adapter.listContentTypes());
  }

  return { definition: saved };
}

/** Shared by POST (create) and PUT (update). */
/**
 * Regenerates `dry.generated.d.ts` and pushes it to `types-cache` storage
 * (`plans/app-r2.md` mục 10) - called after every schema mutation that
 * actually commits (never after a dry-run/"plan"), so the file the browser
 * build pipeline's Editer reads as `extraFiles` never drifts far from the
 * real schema. Errors are logged, not thrown: a stale generated-types file
 * is a DX papercut (bad autocomplete), not a reason to fail a schema save
 * that already committed - see `types-cache.ts`'s own "risk" analysis.
 */
async function regenerateTypesCache(adapter: ContentEngineAdapter): Promise<void> {
  try {
    const allTypes = await adapter.listContentTypes();
    await writeGeneratedDryTypes(generateDryTypes(allTypes));
  } catch (error) {
    console.error("[drycms] failed to regenerate dry.generated.d.ts after a schema change:", error);
  }
}

async function handleSave(
  adapter: ContentEngineAdapter,
  entryAdapter: ContentEntryEngineAdapter,
  definition: ContentTypeDefinition,
  confirm: boolean,
): Promise<Response> {
  const result = await performSave(adapter, entryAdapter, definition, confirm);
  await regenerateTypesCache(adapter);
  return jsonResponse(result, 200);
}

export interface BatchDraftInput {
  definition: ContentTypeDefinition;
}

interface BatchItemResult {
  id: string;
  label: string;
  kind: ContentTypeKind;
  ok: boolean;
  destructiveSummary?: DestructiveChange[];
  error?: string;
}

/**
 * The "Apply and build" flow (see `status/content-type-staged-apply.md`) -
 * every draft the client has pending (across all 3 kinds) in one request.
 * `mode: "plan"` is a pure dry-run (`performSave(..., dryRun: true)` for
 * every item, never writes) used for the review/build-check screen.
 * `mode: "apply"` actually runs each item's migration, sequentially and in
 * the order the client sent them, always with `confirm: true` (the
 * destructive-change review already happened client-side during `"plan"`).
 * Sequential (not parallel) matters here: `performSave` re-reads live state
 * from `adapter.listContentTypes()` on every call, so applying item N sees
 * items 1..N-1 of THIS SAME batch already committed - the only way a
 * component's own draft and one of its dependents' drafts, edited together,
 * both land consistently in one "Apply and build". Stops at the first
 * failure in apply mode (whatever already committed stays committed - each
 * item is its own transaction, see `engine/sqlite.ts`'s `applySave`) so the
 * client knows exactly which drafts are now safe to discard and which are
 * still pending. Plan mode never stops early - every item's result is
 * useful to show at once. */
export async function handleBatch(
  adapter: ContentEngineAdapter,
  entryAdapter: ContentEntryEngineAdapter,
  mode: "plan" | "apply",
  draftInputs: BatchDraftInput[],
): Promise<Response> {
  const results: BatchItemResult[] = [];
  for (const { definition } of draftInputs) {
    try {
      const outcome = await performSave(adapter, entryAdapter, definition, mode === "apply", mode === "plan");
      results.push({
        id: definition.id,
        label: definition.label || definition.name,
        kind: definition.kind,
        ok: true,
        destructiveSummary: outcome.destructiveSummary,
      });
    } catch (error) {
      results.push({
        id: definition.id,
        label: definition.label || definition.name,
        kind: definition.kind,
        ok: false,
        error:
          error instanceof ContentEngineError || error instanceof NamingError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown error.",
      });
      if (mode === "apply") break;
    }
  }
  if (mode === "apply" && results.some((r) => r.ok)) await regenerateTypesCache(adapter);
  return jsonResponse({ mode, results });
}

export const GET: DryRouteHandler = async (context) => {
  try {
    if (!context.session) return unauthenticatedResponse();
    const adapter = getContentAdapters(context).schema;

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
    const { schema: adapter, entries: entryAdapter } = getContentAdapters(context);
    const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
    if (denied) return denied;

    const raw = (await context.request.json()) as Partial<SaveRequestBody> & {
      mode?: "plan" | "apply";
      drafts?: BatchDraftInput[];
    };

    // "Apply and build" (see `status/content-type-staged-apply.md`) - a
    // distinct request shape (`drafts[]` instead of a single `definition`)
    // on the same route/method rather than a new URL segment, since routing
    // here only dispatches on the first path segment + HTTP method (see
    // `server/handler.ts`).
    if (Array.isArray(raw.drafts)) {
      return await handleBatch(adapter, entryAdapter, raw.mode === "apply" ? "apply" : "plan", raw.drafts);
    }

    if (!raw.definition) throw new ContentEngineError("invalid_definition", "Request body must include `definition`.");

    const definition: ContentTypeDefinition = {
      ...raw.definition,
      id: raw.definition.id || randomUUID(),
      version: 0,
    };
    return await handleSave(adapter, entryAdapter, definition, raw.confirm === true);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PUT: DryRouteHandler = async (context) => {
  try {
    const { schema: adapter, entries: entryAdapter } = getContentAdapters(context);
    const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
    if (denied) return denied;

    const id = readId(context);
    if (!id) throw new ContentEngineError("invalid_definition", "An id is required to update a content type.");

    const raw = (await context.request.json()) as Partial<SaveRequestBody>;
    if (!raw.definition) throw new ContentEngineError("invalid_definition", "Request body must include `definition`.");
    if (raw.definition.id && raw.definition.id !== id) {
      throw new ContentEngineError("invalid_definition", "Request body's `definition.id` doesn't match the URL.");
    }

    const definition: ContentTypeDefinition = { ...raw.definition, id };
    return await handleSave(adapter, entryAdapter, definition, raw.confirm === true);
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const { schema: adapter, entries: entryAdapter } = getContentAdapters(context);
    const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
    if (denied) return denied;

    const id = readId(context);
    if (!id) throw new ContentEngineError("invalid_definition", "An id is required to delete a content type.");
    const existing = await adapter.getContentType(id);
    if (existing?.locked || existing?.frozen) {
      throw new ContentEngineError(
        "protected",
        `"${existing.label || existing.name}" can't be deleted.`,
      );
    }
    await adapter.deleteContentType(id);
    await regenerateTypesCache(adapter);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
