import type { BatchResponse } from "./http-api.js";
import type { EntryValue } from "./engine/entry-codec.js";
import type { ContentTypeDefinition } from "./types.js";

export interface SeedPlanItem {
  id: string;
  label: string;
  willApply: boolean;
}

export interface SeedResponse {
  mode: "plan" | "apply";
  singletons: SeedPlanItem[];
  menu: SeedPlanItem | null;
}

export class ContentTypeSeedApiError extends Error {}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const body = await readJson(res);
  throw new ContentTypeSeedApiError(typeof body.message === "string" ? body.message : fallback);
}

/** Thin client for `routes/content-type-seed.ts` - "Upload schema"/"Upload
 * seed data" (`BuilderContentType.tsx`'s two new dialogs). Same
 * plan-then-apply shape `http-api.ts`'s `planBatch`/`applyBatch` already
 * established for "Apply and build" - `kind: "schema"` here IS that same
 * batch endpoint under the hood (see the route's own doc comment), just a
 * separate client so the two feature sets (drafts from `draft-store.ts` vs.
 * an uploaded file's raw content) never share request-building code that
 * doesn't actually overlap. */
export function createContentTypeSeedApi(baseUrl: string) {
  async function post(body: unknown, fallback: string): Promise<any> {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await assertOk(res, fallback);
    return res.json();
  }

  async function planSchema(contentTypes: ContentTypeDefinition[]): Promise<BatchResponse> {
    return post({ kind: "schema", mode: "plan", contentTypes }, "Failed to check uploaded schema.");
  }

  async function applySchema(contentTypes: ContentTypeDefinition[]): Promise<BatchResponse> {
    return post({ kind: "schema", mode: "apply", contentTypes }, "Failed to apply uploaded schema.");
  }

  async function planSeedData(singletonData: Record<string, EntryValue> | undefined, menuData: EntryValue[] | undefined): Promise<SeedResponse> {
    return post({ kind: "seed", mode: "plan", singletonData, menuData }, "Failed to check uploaded seed data.");
  }

  async function applySeedData(singletonData: Record<string, EntryValue> | undefined, menuData: EntryValue[] | undefined): Promise<SeedResponse> {
    return post({ kind: "seed", mode: "apply", singletonData, menuData }, "Failed to apply uploaded seed data.");
  }

  return { planSchema, applySchema, planSeedData, applySeedData };
}

export type ContentTypeSeedApi = ReturnType<typeof createContentTypeSeedApi>;
