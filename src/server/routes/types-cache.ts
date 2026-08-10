import type { DryRouteHandler } from "../context.js";
import { typesCacheStorage } from "../config.js";
import { errorResponse } from "../route-helpers.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { getContentAdapters } from "../content-adapters.js";
import { generateDryTypes } from "../../content-types/codegen.js";
import { writeGeneratedDryTypes } from "../../content-types/types-cache.js";
import { StorageError } from "../../storage/types.js";

const CACHE_ENTRY_NAME = "dry.generated.d.ts";

/**
 * Read side of `types-cache.ts`'s `writeGeneratedDryTypes` - the "future
 * browser-based code editor" its doc comment mentions, now real: the
 * browser build pipeline's `Editer` instance needs `dry.generated.d.ts`'s
 * content as an `extraFiles` entry for its TS Language Service (same
 * mechanism `CodeEditerDemo.tsx` used for cross-file ambient references -
 * see `plans/app-r2.md` mục 10). No `?tree`/folder listing - this root
 * holds exactly one file.
 */
export const GET: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(typesCacheStorage, context);
    const file = await adapter.read(CACHE_ENTRY_NAME);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return new Response(Buffer.concat(chunks).toString("utf-8"), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Last-Modified": new Date(file.modifiedAt).toUTCString() },
    });
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") {
      // Not generated yet - the cache and `.dry/dry.generated.d.ts` (both
      // gitignored) are 2 representations of the same generated data kept
      // in sync for the same reason `src/apps/pages` and `pagesSourceStorage`
      // are (`sync-pages-r2.ts`): this cache is what serves code that
      // isn't compiled from `src` at all (`PageEditor.tsx`'s in-browser
      // Editer, reading `pagesSourceStorage`-backed files no `tsc`/on-disk
      // pass ever sees). Unlike that pair, there's no real "edit" to
      // reconcile here - the content is always fully DERIVED from the
      // current schema, so a miss is just regenerated on the spot instead
      // of requiring a schema save/"Apply and build"
      // (`regenerateTypesCache`'s trigger) or a Node-only dev-server
      // restart (`dev-server.mjs`) to have happened first - neither of
      // which runs automatically under `wrangler dev`/D1, where this was
      // found live serving blank content with no signal why. Uses
      // `getContentAdapters` (not a Node-only adapter constructor) so this
      // works identically in every runtime, D1 included.
      try {
        const output = generateDryTypes(await getContentAdapters(context).schema.listContentTypes());
        await writeGeneratedDryTypes(output);
        return new Response(output, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      } catch (regenError) {
        // Same "never fatal" guarantee the original blank-response fallback
        // had - a DB hiccup here must degrade to "nothing to type yet",
        // not a 500 that breaks the whole Page Editor for it.
        console.error("[drycms] failed to lazily regenerate dry.generated.d.ts:", regenError);
        return new Response("", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    }
    return errorResponse(error);
  }
};
