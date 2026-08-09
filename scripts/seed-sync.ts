/**
 * Snapshots the CURRENT dev content-type DB's full list into
 * `src/apps/dry.seed.json` - the "separate seed script" from `plans/
 * content-type-seed.md`: overwrites the file wholesale each run (a
 * snapshot, not a merge). See `scripts/lib/schema-sync.ts` for the
 * implementation.
 *
 * The only snapshot command - `bun run build:schema` used to be a second
 * entry point that did this plus package `public.zip`; with that media
 * artifact gone (media goes to R2 via `bun run r2:sync` now) it was left
 * doing exactly what this script does, so it was removed rather than kept
 * as a duplicate name for one job.
 *
 * Run with: bun run seed:sync
 */
import { writeContentTypeSeedFile } from "./lib/schema-sync.js";

const result = await writeContentTypeSeedFile();
if (result) console.log(`[drycms] seed:sync wrote ${result.count} content type(s) (${result.singletonCount} with singleton data) -> ${result.target}`);
