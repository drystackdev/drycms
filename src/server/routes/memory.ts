import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

function findType(allTypes: ContentTypeDefinition[], name: string): ContentTypeDefinition {
  const type = allTypes.find((t) => t.name === name);
  if (!type) throw new Error(`[drycms] Content type "${name}" is missing - re-run seeding.`);
  return type;
}

function parseData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function findOwnRow(context: DryRouteContext) {
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const memoryType = findType(allTypes, "memory");
  const existing = await entries.findEntry(memoryType, allTypes, [
    { field: "user", op: "eq", value: context.session!.id },
  ]);
  return { entries, allTypes, memoryType, existing };
}

/**
 * Self-service sync endpoint for the hidden `memory` collection (see
 * `seed.ts`) - always scoped to the CALLING session's own `user` id, never
 * a client-supplied one, and never routed through the generic content-
 * entries permission model (there's no "own row only" grant in
 * `permissions.ts` - see `types.ts`'s `hidden` doc comment and `seed.ts`'s
 * comment on `memory` for why this is a dedicated route instead of the
 * usual `routes/content-entries.ts`). Exactly one row per user, found-or-
 * created here rather than enforced by a DB constraint (no real one-to-one
 * `RelationCardinality` exists - see `field-registry.ts`).
 *
 * Version protocol ("server mới nhất luôn đúng" - the newest server value
 * always wins): the client always sends back whatever `version` it last
 * received. A write whose `version` is behind the server's current value is
 * rejected (409) with the server's own latest copy instead of being merged -
 * the client is expected to overwrite its local copy with that and, if it
 * still wants its own change applied, retry the write on top of the fresh
 * version.
 */
export const GET: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const { existing } = await findOwnRow(context);
  if (!existing) return jsonResponse({ data: {}, version: 0 });
  return jsonResponse({ data: parseData(existing.value.data), version: Number(existing.value.version ?? 0) });
};

interface PutBody {
  data?: unknown;
  version?: number;
}

export const PUT: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const body = (await context.request.json().catch(() => ({}))) as PutBody;
  const clientVersion = Number.isInteger(body.version) ? (body.version as number) : 0;
  const dataValue: Record<string, unknown> = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? (body.data as Record<string, unknown>) : {};

  const { entries, allTypes, memoryType, existing } = await findOwnRow(context);

  if (existing) {
    const serverVersion = Number(existing.value.version ?? 0);
    if (clientVersion < serverVersion) {
      return jsonResponse({ conflict: true, data: parseData(existing.value.data), version: serverVersion }, 409);
    }
    const nextVersion = serverVersion + 1;
    await entries.updateEntry(memoryType, allTypes, existing.id, {
      user: context.session.id,
      data: JSON.stringify(dataValue),
      version: nextVersion,
    });
    return jsonResponse({ data: dataValue, version: nextVersion });
  }

  await entries.createEntry(memoryType, allTypes, {
    user: context.session.id,
    data: JSON.stringify(dataValue),
    version: 1,
  });
  return jsonResponse({ data: dataValue, version: 1 });
};
