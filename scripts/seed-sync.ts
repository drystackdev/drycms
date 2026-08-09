/**
 * Snapshots the CURRENT dev content-type DB's own content types/data (the
 * built-in system defaults excluded - see `scripts/lib/schema-sync.ts`'s own
 * doc comment) into `src/apps/schema.json`/`src/apps/seed.json` - overwrites
 * both wholesale each run (a snapshot, not a merge).
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
if (result) {
  console.log(`[drycms] seed:sync wrote ${result.schemaCount} content type(s) -> ${result.schemaTarget}`);
  console.log(`[drycms] seed:sync wrote ${result.singletonCount} singleton(s) + ${result.menuCount} menu row(s) -> ${result.seedTarget}`);
}
