import type { StorageAdapter } from "../storage/types.js";
import { SAMPLE_PAGES_SOURCE_FILES } from "../server/app-router/sample-pages-source.js";

/**
 * Seeds `pagesSourceStorage` with the bundled starter template
 * (`sample-pages-source.ts`, bundled from git-committed `mock/**`) the FIRST
 * time it is found completely empty. A single root `list("")` (not `listAll` -
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
