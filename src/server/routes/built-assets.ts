import type { DryRouteHandler } from "../context.js";
import { readBuiltAsset } from "../app-router/built-pages-storage.js";
import { errorResponse, readSlug } from "../route-helpers.js";

/**
 * Public, UNAUTHENTICATED read of a built page's compiled JS asset (mục 7 -
 * `hydrate-built.ts` `import()`s these directly in a visitor's browser,
 * which has no session/cookie at all). Same "public GET" treatment
 * `routes/storage.ts` already gives media and the favicon
 * (`render.ts`'s `FAVICON_ICO_HREF`) - nothing here is more sensitive than
 * site source that was ALREADY compiled client-side to produce the page a
 * visitor is currently looking at. `handler.ts`'s central session gate has
 * a matching exemption for this segment, mirroring `isPublicStorageRead`.
 */
export const GET: DryRouteHandler = async (context) => {
  try {
    const jsPath = readSlug(context);
    if (!jsPath) return errorResponse(new Error("A JS asset path is required."));
    const source = await readBuiltAsset(context, jsPath);
    if (source === null) return new Response("Not found", { status: 404 });
    return new Response(source, {
      status: 200,
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=60" },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
