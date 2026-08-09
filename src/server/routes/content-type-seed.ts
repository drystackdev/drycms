import type { DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { requirePermission } from "../admin-access.js";
import { CONTENT_TYPES_RESOURCE_ID } from "../../content-types/permissions.js";
import { applyPackagedMenuData, applyPackagedSingletonData, defaultContentTypeDefinitions, MENU_TYPE_ID, type PackagedSeed } from "../../content-types/seed.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { errorResponse, handleBatch, type BatchDraftInput } from "./content-types.js";
import { jsonResponse } from "../route-helpers.js";

/**
 * "Upload schema" / "Upload seed data" (`BuilderContentType.tsx`) - the
 * manual, admin-triggered replacement for the old always-on-boot packaged
 * `dry.seed.json` (removed: a static import of a committed file meant that
 * deleting it 500'd every server-rendered page, and it silently REPLACED
 * the built-in system types on every boot regardless of whether that was
 * wanted). A fresh install now always gets exactly the 12 system defaults
 * (`content-types/seed.ts`'s `defaultContentTypeDefinitions`); an app's own
 * content types/data only ever arrive through this route, whenever an admin
 * explicitly picks a file and confirms.
 *
 * Two independent operations selected by `kind`, each with the same
 * `mode: "plan" | "apply"` dry-run-then-write shape `routes/content-types.ts`'s
 * "Apply and build" already established:
 *
 * - `kind: "schema"` is a thin wrapper around that SAME route's `handleBatch`
 *   - an uploaded `schema.json`'s `contentTypes[]` is just another
 *   `BatchDraftInput[]`, so create-or-update / version-conflict /
 *   destructive-change-confirm all come for free, with zero new logic here
 *   beyond rejecting a system id outright (defense in depth - `performSave`'s
 *   `assertNotFrozen` only actually blocks `role`/`aiKey`, not e.g. `menu`/
 *   `redirect`, and a hand-edited upload could contain either).
 * - `kind: "seed"` applies `singletonData`/`menuData` via `seed.ts`'s
 *   `applyPackagedSingletonData`/`applyPackagedMenuData`, which already skip
 *   anything that already has live data - "plan" mode just reports the same
 *   will-apply/will-skip check those functions make internally, without
 *   writing anything, so the admin sees it before confirming.
 */

interface SchemaRequestBody {
  kind: "schema";
  mode?: "plan" | "apply";
  contentTypes: ContentTypeDefinition[];
}

interface SeedRequestBody {
  kind: "seed";
  mode?: "plan" | "apply";
  singletonData?: Record<string, EntryValue>;
  menuData?: EntryValue[];
}

interface SeedPlanItem {
  id: string;
  label: string;
  willApply: boolean;
}

function isSchemaBody(raw: unknown): raw is SchemaRequestBody {
  return !!raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "schema" && Array.isArray((raw as { contentTypes?: unknown }).contentTypes);
}

function isSeedBody(raw: unknown): raw is SeedRequestBody {
  return !!raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "seed";
}

async function handleSchema(
  adapter: Parameters<typeof handleBatch>[0],
  entryAdapter: Parameters<typeof handleBatch>[1],
  body: SchemaRequestBody,
): Promise<Response> {
  const systemIds = new Set(defaultContentTypeDefinitions().map((t) => t.id));
  const collision = body.contentTypes.find((definition) => systemIds.has(definition.id));
  if (collision) {
    return jsonResponse(
      { error: "invalid_definition", message: `"${collision.label || collision.name}" uses a reserved system content-type id and can't be uploaded.` },
      400,
    );
  }
  const drafts: BatchDraftInput[] = body.contentTypes.map((definition) => ({ definition }));
  return await handleBatch(adapter, entryAdapter, body.mode === "apply" ? "apply" : "plan", drafts);
}

/** Same will-apply/will-skip check `applyPackagedSingletonData`/
 * `applyPackagedMenuData` make internally, computed here (read-only) so
 * both "plan" and "apply" can report identical results - "apply" just runs
 * this immediately before actually writing, since those functions have no
 * partial-failure notion of their own to report separately. */
async function planSeed(
  entryAdapter: Parameters<typeof handleBatch>[1],
  allTypes: ContentTypeDefinition[],
  body: SeedRequestBody,
): Promise<{ singletons: SeedPlanItem[]; menu: SeedPlanItem | null }> {
  const singletons: SeedPlanItem[] = [];
  for (const [id, value] of Object.entries(body.singletonData ?? {})) {
    if (!value) continue;
    const type = allTypes.find((t) => t.id === id && t.kind === "singleton");
    if (!type) continue;
    const existing = await entryAdapter.getSingletonEntry(type, allTypes);
    singletons.push({ id, label: type.label || type.name, willApply: !existing });
  }

  let menu: SeedPlanItem | null = null;
  if (body.menuData && body.menuData.length > 0) {
    const menuType = allTypes.find((t) => t.id === MENU_TYPE_ID && t.kind === "collection");
    if (menuType) {
      const existing = await entryAdapter.listEntries(menuType, allTypes, { page: 0, pageSize: 1 });
      menu = { id: MENU_TYPE_ID, label: menuType.label || menuType.name, willApply: existing.rows.length === 0 };
    }
  }

  return { singletons, menu };
}

async function handleSeed(
  adapter: Parameters<typeof handleBatch>[0],
  entryAdapter: Parameters<typeof handleBatch>[1],
  body: SeedRequestBody,
): Promise<Response> {
  const allTypes = await adapter.listContentTypes();
  const plan = await planSeed(entryAdapter, allTypes, body);

  if (body.mode !== "apply") {
    return jsonResponse({ mode: "plan", ...plan });
  }

  const packagedSeed: PackagedSeed = { contentTypes: allTypes, singletonData: body.singletonData, menuData: body.menuData };
  await applyPackagedSingletonData(entryAdapter, allTypes, packagedSeed);
  await applyPackagedMenuData(entryAdapter, allTypes, packagedSeed);
  return jsonResponse({ mode: "apply", ...plan });
}

export const POST: DryRouteHandler = async (context) => {
  try {
    const { schema: adapter, entries: entryAdapter } = getContentAdapters(context);
    const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
    if (denied) return denied;

    const raw: unknown = await context.request.json();
    if (isSchemaBody(raw)) return await handleSchema(adapter, entryAdapter, raw);
    if (isSeedBody(raw)) return await handleSeed(adapter, entryAdapter, raw);
    return jsonResponse({ error: "invalid_definition", message: 'Request body must include `kind: "schema"` or `kind: "seed"`.' }, 400);
  } catch (error) {
    return errorResponse(error);
  }
};
