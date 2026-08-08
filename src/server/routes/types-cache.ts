import type { DryRouteHandler } from "../context.js";
import { typesCacheStorage } from "../config.js";
import { errorResponse } from "../route-helpers.js";
import { getStorageAdapter } from "../storage-adapters.js";
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
      // Not generated yet (a brand-new project before its first schema
      // save/dev-server startup) - an empty file is a valid "nothing to
      // type yet" answer, not an error the caller needs to branch on.
      return new Response("", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    return errorResponse(error);
  }
};
