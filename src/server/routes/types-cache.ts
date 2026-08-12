import type { DryRouteHandler } from "../context.js";
import { readGeneratedDryTypes } from "../../content-types/types-cache.js";

/**
 * Read side of `types-cache.ts`'s `writeGeneratedDryTypes` - the "future
 * browser-based code editor" its doc comment mentions, now real: the
 * browser build pipeline's `Editer` instance needs `dry.generated.d.ts`'s
 * content as an `extraFiles` entry for its TS Language Service (same
 * mechanism `CodeEditerDemo.tsx` used for cross-file ambient references -
 * see `plans/app-r2.md` mục 10). No `?tree`/folder listing - this root
 * holds exactly one file.
 *
 * The actual read (plus the "not generated yet - regenerate on the spot"
 * fallback this route originally had inline) now lives in
 * `readGeneratedDryTypes` - shared with the Page Editor Magic Chat's `kind:
 * read, root: "types"` and the MCP `read_dry_types` tool, which need the
 * exact same content.
 */
export const GET: DryRouteHandler = async (context) => {
  try {
    const output = await readGeneratedDryTypes(context);
    return new Response(output, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    // Same "never fatal" guarantee the original inline fallback had - a DB
    // hiccup regenerating the cache must degrade to "nothing to type yet",
    // not a 500 that breaks the whole Page Editor for it.
    console.error("[drycms] failed to read/lazily regenerate dry.generated.d.ts:", error);
    return new Response("", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
};
