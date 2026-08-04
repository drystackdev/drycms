import { mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { createStorageAdapter } from "../storage/index.js";
import { typesCacheStorage } from "../server/config.js";

const GENERATED_DIR = resolvePath(process.cwd(), "src/apps");
const GENERATED_FILE_PATH = resolvePath(GENERATED_DIR, "dry.generated.d.ts");
const CACHE_ENTRY_NAME = "dry.generated.d.ts";

/**
 * Writes `dry.generated.d.ts`'s generated content to BOTH its real on-disk
 * location (still needed by local `tsc`/IDE tooling - `reader.md`'s own
 * decision, unchanged) and a `types-cache` root (see `plans/app-router.md`'s
 * "Cache cho `dry.generated.d.ts`") - prep for a future browser-based code
 * editor to read this over an API instead of the filesystem, not built yet.
 * Same 2 triggers as before (`scripts/dev-server.mjs` startup + `bun run
 * dry:generate`) and same `generateDryTypes()` algorithm - only the write
 * destination changed, from 1 place to 2.
 */
export async function writeGeneratedDryTypes(output: string): Promise<void> {
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(GENERATED_FILE_PATH, output);

  const storage = createStorageAdapter(typesCacheStorage);
  await storage.write(CACHE_ENTRY_NAME, Buffer.from(output, "utf8"));
}
