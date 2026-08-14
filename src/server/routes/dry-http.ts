import { runWithDryContext, type DryRequestContext } from "../../content-types/dry-context.js";
import { dry } from "../../content-types/dry-reader.js";
import type { DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { encodeCallLog } from "../app-router/dry-replay-codec.js";
import { errorResponse, forbiddenResponse, unauthenticatedResponse } from "../route-helpers.js";
import { resolveAccessCached } from "../../content-types/access.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../../content-types/permissions.js";

/**
 * Server side of `dry-reader-http.ts` (`plans/app-r2.md` mục 3) - the ONLY
 * new code this endpoint needed is the endpoint itself; the actual query
 * logic is the real `dry-reader.ts`'s `dry()`, unmodified, run through
 * `runWithDryContext` exactly like a normal SSR render.
 *
 * Published-only is enforced by omission, not validation: `context.vei` is
 * never set (so `markRecord` takes its inert-`$` branch, same as an
 * anonymous visitor - `dry-populate.ts`'s `markRecord` line ~39), and
 * `list()`'s `includeDraft` is never read off the request body at all -
 * there is no code path here that could honor a caller-supplied "give me
 * drafts too", so there's nothing to check for and reject. `get()`'s
 * numeric-id/slug branches in `dry-reader.ts` are ALREADY unconditionally
 * published-only with no override (see that file's own doc comment) - true
 * for every caller of `dry()`, not something this endpoint adds.
 */
interface DryHttpRequestBody {
  kind: "collection" | "singleton";
  name: string;
  method: "get" | "list";
  idOrSlug?: number | string;
  populate?: string[];
  /** Field NAMES only - `select`'s function transforms never cross HTTP,
   * see `dry-reader-http.ts`'s doc comment. Every named field is requested
   * as `true` (real value, no transform) - this endpoint has no way to
   * receive or run a transform function at all. */
  selectFields?: string[];
  where?: unknown;
  sort?: { field: string; dir?: "asc" | "desc" };
  page?: number;
  pageSize?: number;
  include?: string[];
}

function isValidBody(value: unknown): value is DryHttpRequestBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    (body.kind === "collection" || body.kind === "singleton") &&
    typeof body.name === "string" &&
    (body.method === "get" || body.method === "list")
  );
}

export const POST: DryRouteHandler = async (context) => {
  try {
    const raw: unknown = await context.request.json();
    if (!isValidBody(raw)) {
      return errorResponse(new Error("Invalid dry() HTTP request body."));
    }
    const body = raw;

    const { schema, entries } = getContentAdapters(context);
    const allTypes = await schema.listContentTypes();

    // Authorization: a build orchestrator running under the code-edit
    // permission (`PAGE_BUILDER_RESOURCE_ID`) may query any resource, same
    // as before this check existed. Anyone else needs `view` (`setting` for
    // a singleton - same split `content-entries.ts`'s own `checkAccess`
    // uses) on the SPECIFIC type being queried, resolved fresh per request -
    // this endpoint has no other gate of its own now that `handler.ts` no
    // longer blanket-requires the code-edit permission for this segment.
    // Without this, a content editor's newly-allowed build access
    // (`routes/pages-build.ts`) would double as a way to read ANY other
    // resource's published data over `dry-http`, not just the one they
    // actually have rights to. `context.session` itself already falls back
    // to a VEI session (`handler.ts`'s dispatcher) when the real admin
    // session expired but a VEI one is still valid - `vei-live-refresh.ts`
    // calling this from a public page relies on that.
    if (!context.session) return unauthenticatedResponse();
    const access = await resolveAccessCached(context, entries, allTypes, context.session);
    if (!access) return unauthenticatedResponse();
    if (!access.can(PAGE_BUILDER_RESOURCE_ID, "setting")) {
      const targetType = allTypes.find((t) => t.name === body.name && t.kind === body.kind);
      const requiredAction = body.kind === "singleton" ? "setting" : "view";
      if (!targetType || !access.can(targetType.id, requiredAction)) return forbiddenResponse();
    }

    const touchedTypes = new Set<string>();
    const dryContext: DryRequestContext = { entries, allTypes, callLog: [], touchedTypes };
    const reader = dry();

    await runWithDryContext(dryContext, async () => {
      if (body.kind === "collection") {
        const collectionReader = reader.collection(body.name);
        if (body.method === "get") {
          if (body.idOrSlug === undefined) throw new Error("idOrSlug is required for get().");
          if (body.populate && body.populate.length > 0) {
            await collectionReader.get(body.idOrSlug, { populate: body.populate });
          } else {
            await collectionReader.get(body.idOrSlug);
          }
        } else {
          // Cast the whole options object rather than each field: this is a
          // dynamic call reconstructed from untyped JSON, so there's no real
          // static type to preserve here - `DryListOptions`'s `select`
          // overload only narrows correctly for a literal object TS can see
          // at the call site, which this isn't.
          await collectionReader.list({
            where: body.where,
            sort: body.sort,
            page: body.page,
            pageSize: body.pageSize,
            include: body.include,
            select: body.selectFields ? Object.fromEntries(body.selectFields.map((field) => [field, true])) : undefined,
          } as never);
        }
      } else {
        const singletonReader = reader.singleton(body.name);
        if (body.populate && body.populate.length > 0) {
          await singletonReader.get({ populate: body.populate });
        } else {
          await singletonReader.get();
        }
      }
    });

    const entry = dryContext.callLog?.[0];
    if (!entry) throw new Error("dry() call produced no result.");

    // The build orchestrator needs to know exactly which resource this call
    // touched AND its version RIGHT NOW, to record into `_page_deps`
    // (`plans/app-r2.md` mục 5) - `touchedTypes` is normally
    // `page-handler.ts`'s concern, reused here for the same purpose. A
    // header (not the JSON body) so `dry-replay-codec.ts`'s
    // `encodeCallLog`/`decodeCallLog` contract stays exactly what
    // `render.ts`'s hydration path already relies on, untouched.
    const touchedName = [...touchedTypes][0];
    const touchedType = touchedName ? allTypes.find((t) => t.name === touchedName) : undefined;
    const version = touchedType ? await entries.getResourceVersion(touchedType) : 0;

    return new Response(encodeCallLog([entry]), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Dry-Resource": touchedName ?? "",
        "X-Dry-Resource-Version": String(version),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
