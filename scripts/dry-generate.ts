/**
 * Regenerates `src/apps/dry.generated.d.ts` from the current content types -
 * the same generation `scripts/dev-server.mjs` runs once on startup, exposed
 * standalone for CI or a manual re-run without restarting the dev server
 * (e.g. right after an "Apply and build" - see `plans/reader.md`).
 *
 * Run with: bun run dry:generate
 *
 * A plain `.ts` script (not `.mjs` like `build-icons.mjs`) run directly via
 * `bun`, not `node` - unlike `build-icons.mjs`, this imports real project
 * `.ts` modules (`server/config.ts`, `content-types/**`), and Bun resolves
 * those natively without needing Vite's `ssrLoadModule` the way
 * `dev-server.mjs` does for the live dev server.
 */
import { createContentEngineAdapter } from "../src/content-types/engine/index.js";
import { generateDryTypes } from "../src/content-types/codegen.js";
import { writeGeneratedDryTypes } from "../src/content-types/types-cache.js";
import { content } from "../src/server/config.js";

if (content.engine === "D1") {
  console.log('[drycms] content.engine is "D1" - dry.generated.d.ts can\'t be generated from a standalone script (no local D1 binding to read). Skipping.');
  process.exit(0);
}

const adapter = createContentEngineAdapter(content);
const allTypes = await adapter.listContentTypes();
const output = generateDryTypes(allTypes);
await writeGeneratedDryTypes(output);

console.log(`[drycms] generated dry.generated.d.ts (${allTypes.length} content types)`);
