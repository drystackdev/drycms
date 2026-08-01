import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { content } from "../config.js";
import { resolveAccess } from "../../content-types/access.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../content-types/engine/index.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import {
  ContentEngineError,
  type AnyDestructiveChange,
  type AnySavePlan,
  type ContentEngineAdapter,
} from "../../content-types/engine/types.js";
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
import { forbiddenResponse, unauthenticatedResponse } from "../route-helpers.js";

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  already_exists: 409,
  version_conflict: 409,
  invalid_definition: 400,
  in_use: 409,
  unsupported: 501,
  protected: 403,
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
 * single open connection / a local `StorageAdapter` module-cached exactly
 * like `routes/storage.ts`'s adapter - no local backend needs a
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

/** Schema WRITES (POST/PUT/DELETE here) have no per-resource permission
 * action of their own in the existing model (only entries do - see
 * `content-types/access.ts`/`permissions.ts`) - restricted to Super Admin
 * outright instead. Schema READS (`GET`) stay open to any authenticated user
 * (`if (!context.session) return unauthenticatedResponse()` alone) since the
 * sidebar and every entry editor need the type list regardless of role. */
async function requireSuperAdmin(
  context: DryRouteContext,
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const access = await resolveAccess(entryAdapter, allTypes, context.session);
  if (!access?.isSuperAdmin) return forbiddenResponse("Only Super Admin can edit content type schemas.");
  return null;
}

interface SaveRequestBody {
  definition: ContentTypeDefinition;
  confirm?: boolean;
}

interface SaveResultData {
  requiresConfirm?: true;
  destructiveSummary?: AnyDestructiveChange[];
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
async function handleSave(
  adapter: ContentEngineAdapter,
  entryAdapter: ContentEntryEngineAdapter,
  definition: ContentTypeDefinition,
  confirm: boolean,
): Promise<Response> {
  return jsonResponse(await performSave(adapter, entryAdapter, definition, confirm), 200);
}

interface BatchDraftInput {
  definition: ContentTypeDefinition;
}

interface BatchItemResult {
  id: string;
  label: string;
  kind: ContentTypeKind;
  ok: boolean;
  destructiveSummary?: AnyDestructiveChange[];
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
async function handleBatch(
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
  return jsonResponse({ mode, results });
}

export const GET: DryRouteHandler = async (context) => {
  try {
    if (!context.session) return unauthenticatedResponse();
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
    const entryAdapter = getEntryAdapter(context);
    const denied = await requireSuperAdmin(context, entryAdapter, await adapter.listContentTypes());
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
    const adapter = getAdapter(context);
    const entryAdapter = getEntryAdapter(context);
    const denied = await requireSuperAdmin(context, entryAdapter, await adapter.listContentTypes());
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
    const adapter = getAdapter(context);
    const entryAdapter = getEntryAdapter(context);
    const denied = await requireSuperAdmin(context, entryAdapter, await adapter.listContentTypes());
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
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
