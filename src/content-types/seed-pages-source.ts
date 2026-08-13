import type { StorageAdapter } from "../storage/types.js";
import { SAMPLE_PAGES_SOURCE_FILES } from "../server/app-router/sample-pages-source.js";

/**
 * Seeds `pagesSourceStorage` with the bundled starter template
 * (`sample-pages-source.ts`, mirroring the git-committed `src/apps/{pages,
 * component,styles,md}/**`) the FIRST time it's found completely empty - a
 * fresh tenant deploy otherwise ships with zero site pages until someone
 * runs `bun run pages:sync --push --remote` by hand (AGENTS.md's
 * "website-builder TOOL" section). A single root `list("")` (not `listAll` -
 * that's `local`-only, see `StorageAdapter.listAll`'s own doc comment; R2
 * doesn't implement it) is enough: an untouched store has no `pages`/
 * `component`/`styles`/`md` folder at all yet, so ANY root entry means real
 * content already exists and this no-ops rather than clobbering it.
 */
export async function seedPagesSourceIfEmpty(adapter: StorageAdapter): Promise<boolean> {
  const rootEntries = await adapter.list("");
  if (rootEntries.length > 0) return false;

  for (const file of SAMPLE_PAGES_SOURCE_FILES) {
    await adapter.write(file.path, new TextEncoder().encode(file.content));
  }
  return true;
}
