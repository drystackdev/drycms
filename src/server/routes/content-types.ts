import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import {
  ContentEngineError,
  type ContentEngineAdapter,
  type SaveBatchContext,
} from "../../content-types/engine/types.js";
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
import type { ComponentFieldConfig } from "../../content-types/field-registry.js";
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
  /** Version bumps this save's component cascade applied to OTHER content
   * types (see `migration.ts`'s `planSave`) - internal to `handleBatch`,
   * stripped before anything reaches the HTTP response. */
  cascadedVersions?: { id: string; from: number; to: number }[];
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
  batch: SaveBatchContext = {},
): Promise<SaveResultData> {
  definition = normalizeFieldOrder(definition);
  const liveTypes = await adapter.listContentTypes();
  const existing = liveTypes.find((t) => t.id === definition.id);
  assertNotFrozen(existing);

  // What names/tables/component references are checked AGAINST: the live
  // schema with this batch's OTHER pending drafts layered over it (a draft
  // shadows the live definition of the same id). `existing` above stays
  // strictly live - `assertNotFrozen`/`validateProtectedFields` compare
  // against what's really stored, not against another unapplied draft.
  // Without the overlay a brand-new component and a brand-new singleton that
  // embeds it can never be checked together: whichever is checked first only
  // sees a schema the other half of the pair isn't in yet, so it fails with
  // "references missing component" even though the batch as a whole is fine.
  const pendingTypes = (batch.pendingTypes ?? []).filter((t) => t.id !== definition.id);
  const allTypes =
    pendingTypes.length === 0
      ? liveTypes
      : [...liveTypes.filter((t) => !pendingTypes.some((p) => p.id === t.id)), ...pendingTypes];
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
      let otherTableNames: string[];
      try {
        otherTableNames = collectTableNames(resolveTableTree(other, allTypes));
      } catch {
        // Only reachable for an unapplied draft from this same batch that
        // doesn't resolve yet (a live definition always does). That draft
        // reports its own error under its own batch item - it must not make
        // every OTHER item in the batch fail with someone else's problem.
        continue;
      }
      const collision = newTableNames.find((name) => otherTableNames.includes(name));
      if (collision) {
        throw new NamingError(
          `Content type "${definition.name}" would generate table "${collision}", which is already used by "${other.name}".`,
        );
      }
    }
  }

  const plan: SavePlan = await adapter.planSave(definition, {
    // Dry-run only: a real apply relies on `handleBatch`'s dependency-first
    // ordering instead, so a batch that fails halfway can never leave a table
    // built from a component that never made it into the live schema.
    pendingTypes: dryRun ? pendingTypes : undefined,
  });
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

  return {
    definition: saved,
    cascadedVersions: plan.cascaded.map((cascade) => ({
      id: cascade.targetContentTypeId,
      from: cascade.expectedVersion,
      to: cascade.nextVersion,
    })),
  };
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
async function regenerateTypesCache(adapter: ContentEngineAdapter, context: Pick<DryRouteContext, "env">): Promise<void> {
  try {
    const allTypes = await adapter.listContentTypes();
    await writeGeneratedDryTypes(generateDryTypes(allTypes), context);
  } catch (error) {
    console.error("[drycms] failed to regenerate dry.generated.d.ts after a schema change:", error);
  }
}

async function handleSave(
  adapter: ContentEngineAdapter,
  entryAdapter: ContentEntryEngineAdapter,
  definition: ContentTypeDefinition,
  confirm: boolean,
  context: Pick<DryRouteContext, "env">,
): Promise<Response> {
  const { cascadedVersions, ...result } = await performSave(adapter, entryAdapter, definition, confirm);
  void cascadedVersions; // batch bookkeeping only - never part of the response
  await regenerateTypesCache(adapter, context);
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
 * Reorders one batch so a draft always lands AFTER every other draft in the
 * batch it embeds (a component before whatever flattens/repeats it, however
 * deeply components nest). The client sends its drafts in arbitrary order -
 * without this, creating a component and a singleton that uses it in one
 * "Apply and build" fails whenever the singleton happens to come first: its
 * migration resolves against the live schema, which the component hasn't
 * reached yet. Depth-first post-order; a cycle (which `resolveTableTree`
 * rejects with a proper "Circular component reference" error anyway) just
 * keeps its incoming relative order instead of looping.
 */
function orderByDependency(inputs: BatchDraftInput[]): BatchDraftInput[] {
  const byId = new Map(inputs.map((input) => [input.definition.id, input]));
  const ordered: BatchDraftInput[] = [];
  const visiting = new Set<string>();
  const placed = new Set<string>();

  function visit(input: BatchDraftInput): void {
    const { id } = input.definition;
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const field of input.definition.fields) {
      if (field.type !== "component") continue;
      // Defensive, not just a type guard: `config` shape is only guaranteed
      // for a definition that already passed validation, and this ordering
      // pass runs BEFORE `performSave` validates anything. A malformed/
      // missing `config` (bad client input) must fall through to that real,
      // per-item validation - not crash the whole batch request with an
      // uncaught exception (which surfaces as an opaque 500 to every item,
      // not just the bad one).
      const componentId = (field.config as Partial<ComponentFieldConfig> | undefined)?.componentId;
      if (typeof componentId !== "string") continue;
      const dependency = byId.get(componentId);
      if (dependency) visit(dependency);
    }
    visiting.delete(id);
    placed.add(id);
    ordered.push(input);
  }

  for (const input of inputs) visit(input);
  return ordered;
}

/**
 * The "Apply and build" flow (see `status/content-type-staged-apply.md`) -
 * every draft the client has pending (across all 3 kinds) in one request.
 * `mode: "plan"` is a pure dry-run (`performSave(..., dryRun: true)` for
 * every item, never writes) used for the review/build-check screen.
 * `mode: "apply"` actually runs each item's migration, sequentially, always
 * with `confirm: true` (the destructive-change review already happened
 * client-side during `"plan"`).
 * Sequential (not parallel) matters here: `performSave` re-reads live state
 * from `adapter.listContentTypes()` on every call, so applying item N sees
 * items 1..N-1 of THIS SAME batch already committed - the only way a
 * component's own draft and one of its dependents' drafts, edited together,
 * both land consistently in one "Apply and build". `orderByDependency` below
 * is what makes that ordering reliable rather than whatever order the client
 * happened to send. Stops at the first failure in apply mode (whatever
 * already committed stays committed - each item is its own transaction, see
 * `engine/sqlite.ts`'s `applySave`) so the client knows exactly which drafts
 * are now safe to discard and which are still pending. Plan mode never stops
 * early - every item's result is useful to show at once. */
export async function handleBatch(
  adapter: ContentEngineAdapter,
  entryAdapter: ContentEntryEngineAdapter,
  mode: "plan" | "apply",
  draftInputs: BatchDraftInput[],
  context: Pick<DryRouteContext, "env">,
): Promise<Response> {
  const ordered = orderByDependency(draftInputs);
  const allDrafts = ordered.map((input) => input.definition);
  /** Version bumps an EARLIER item's component cascade already applied to a
   * type still waiting its turn in this same batch, keyed by that type's id.
   * Saving a component rebuilds every dependent's tables and bumps their
   * `version` (`migration.ts`'s `planSave`) - so a dependent whose own draft
   * is also pending here would otherwise arrive holding the version it had
   * BEFORE that bump and be rejected as a stale edit, even though the only
   * thing that moved it was this very batch. Rewritten only when the draft
   * still matches the exact pre-bump version: a mismatch means someone else
   * really did edit it meanwhile, which must still conflict. */
  const cascadedVersions = new Map<string, { from: number; to: number }>();
  const results: BatchItemResult[] = [];
  for (let definition of allDrafts) {
    const otherDrafts = allDrafts.filter((draft) => draft.id !== definition.id);
    const bumped = cascadedVersions.get(definition.id);
    if (bumped && definition.version === bumped.from) {
      definition = { ...definition, version: bumped.to };
    }
    try {
      const outcome = await performSave(adapter, entryAdapter, definition, mode === "apply", mode === "plan", {
        pendingTypes: otherDrafts,
      });
      for (const cascade of outcome.cascadedVersions ?? []) {
        cascadedVersions.set(cascade.id, { from: cascade.from, to: cascade.to });
      }
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
  if (mode === "apply" && results.some((r) => r.ok)) await regenerateTypesCache(adapter, context);
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
      return await handleBatch(adapter, entryAdapter, raw.mode === "apply" ? "apply" : "plan", raw.drafts, context);
    }

    if (!raw.definition) throw new ContentEngineError("invalid_definition", "Request body must include `definition`.");

    const definition: ContentTypeDefinition = {
      ...raw.definition,
      id: raw.definition.id || randomUUID(),
      version: 0,
    };
    return await handleSave(adapter, entryAdapter, definition, raw.confirm === true, context);
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
    return await handleSave(adapter, entryAdapter, definition, raw.confirm === true, context);
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
    await regenerateTypesCache(adapter, context);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
