import { createStorageAdapter } from "../storage/index.js";
import { typesCacheStorage } from "../server/config.js";

const CACHE_ENTRY_NAME = "dry.generated.d.ts";

/**
 * Writes `dry.generated.d.ts`'s generated content to a `types-cache` storage
 * root (see `plans/app-router.md`'s "Cache cho `dry.generated.d.ts`") - now
 * actually read back by `routes/types-cache.ts` for the browser build
 * pipeline's Editer `extraFiles` (`plans/app-r2.md` mục 10), the "future
 * browser-based code editor" this was originally prep for.
 *
 * ALSO writes the real on-disk `.dry/dry.generated.d.ts` (still needed by
 * local `tsc`/IDE tooling - `reader.md`'s own decision, unchanged, though
 * the file itself moved out of `src/apps/` and out of git on 2026-08-10:
 * it's derived from the live content-type schema, not from code, so it
 * doesn't belong in commits any more than `.dry/content.sqlite` does) - but
 * only when a filesystem is actually available. This function is no longer
 * called from Node-only scripts exclusively (see `routes/content-types.ts`'s
 * `regenerateTypesCache`, which runs on every request-handling runtime
 * including a Workers isolate, which has no filesystem at all) - a bare
 * `node:fs/promises` import at module scope would have broken that runtime
 * outright, not just skipped the disk write, so the import itself is
 * deferred into the branch that needs it.
 */
export async function writeGeneratedDryTypes(output: string): Promise<void> {
  const storage = createStorageAdapter(typesCacheStorage);
  await storage.write(CACHE_ENTRY_NAME, Buffer.from(output, "utf8"));

  if (typeof process === "undefined" || !process.versions?.node) return;
  // The path below is resolved from the working directory rather than from
  // any config a test could point elsewhere - so under vitest this would
  // overwrite it with whatever the test passed in. That's exactly what
  // happened once for real, back when this lived at the committed
  // `src/apps/dry.generated.d.ts`: `sivelap` shipped a copy containing only
  // `declare const marker: 'stored-verbatim';` - the fixture from
  // `server/routes/types-cache.test.ts`, committed after a test run left it
  // dirty. Only the on-disk mirror is skipped; the `typesCacheStorage` write
  // above is what those tests actually assert on, and it already goes to a
  // temp dir they control. Moving the file under `.dry/` (gitignored) removes
  // the "committed" half of that risk, but the write is still skipped here
  // since nothing should clobber a file mid-test-run regardless.
  if (process.env.VITEST) return;
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { resolve: resolvePath } = await import("node:path");
    const generatedDir = resolvePath(process.cwd(), ".dry");
    await mkdir(generatedDir, { recursive: true });
    await writeFile(resolvePath(generatedDir, "dry.generated.d.ts"), output);
  } catch (error) {
    // Best-effort: a request-time caller (`regenerateTypesCache`) must never
    // fail the schema-apply response just because, say, the working
    // directory isn't writable in some deploy environment - the
    // `types-cache` storage write above already succeeded, which is the
    // copy every runtime actually depends on going forward.
    console.error("[drycms] failed to write on-disk dry.generated.d.ts:", error);
  }
}
