/**
 * Snapshots the CURRENT dev content-type DB's full list into `dry.seed.json`
 * at the repo root - the "separate seed script" from `plans/
 * content-type-seed.md`: overwrites the file wholesale each run (a
 * snapshot, not a merge). See `scripts/lib/schema-sync.ts` for the shared
 * implementation (`bun run build:schema` uses the same one, alongside
 * `public.zip`).
 *
 * Run with: bun run seed:sync
 */
import { writeContentTypeSeedFile } from "./lib/schema-sync.js";

const result = await writeContentTypeSeedFile();
if (result) console.log(`[drycms] seed:sync wrote ${result.count} content type(s) -> ${result.target}`);
