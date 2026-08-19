/**
 * Writes placeholder versions of every gitignored `*.generated.ts` file that
 * something imports UNCONDITIONALLY - ONLY IF one isn't already on disk;
 * never overwrites a real one a build script just wrote. Neither file is
 * committed (`.gitignore`): a committed real value can only ever be exactly
 * as fresh as whichever commit last remembered to rerun the real generator
 * and commit the result - drift there is exactly what let
 * `generated-asset-hrefs.ts`'s baked-in asset hash outlive the actual built
 * assets it pointed at on a live deploy. Never committing a real value
 * removes that failure mode: every real build (`bun run build`/
 * `build:worker`) regenerates both fresh, in the same run that produces
 * whatever they describe, so the two can never disagree. The placeholder
 * values below are never read outside that real build path.
 *
 * Run via `package.json`'s `postinstall` - `bun install` is the one step
 * every entry point (`dev`, `typecheck`, `test`, `build`, `build:worker`)
 * shares, so the hard imports below (`assets.ts`, `routes/full-reset.ts`)
 * always resolve, even on a completely fresh checkout that has never run a
 * real build.
 */
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function ensure(relativePath: string, contents: string): void {
  const target = fileURLToPath(new URL(relativePath, import.meta.url));
  if (existsSync(target)) return;
  writeFileSync(target, contents);
  console.log(`[drycms] wrote placeholder ${relativePath.replace("../src/", "src/")}`);
}

ensure(
  "../src/server/app-router/generated-asset-hrefs.ts",
  `// Placeholder - never committed (see .gitignore) and never read outside a\n` +
    `// production build (\`assets.ts\`'s own doc comment). \`bun run build\`/\n` +
    `// \`build:worker\` overwrite this with real values via\n` +
    `// \`asset-hrefs-plugin.ts\` before anything reads it for real.\n` +
    `export const HYDRATE_ENTRY_HREF = "/assets/__unbuilt__.js";\n` +
    `export const EDIT_LAUNCHER_HREF = "/assets/__unbuilt__.js";\n` +
    `export const HYDRATE_BUILT_HREF = "/assets/__unbuilt__.js";\n`,
);

ensure(
  "../src/content-types/engine/fresh-boot-dump.generated.ts",
  `// Placeholder - never committed (see .gitignore) and never read outside a\n` +
    `// D1/Workers deploy (\`routes/full-reset.ts\`'s own doc comment). Obviously\n` +
    `// non-functional on purpose: a real value only ever comes from\n` +
    `// \`scripts/build-fresh-boot-dump.ts\`, chained into \`bun run build:worker\`.\n` +
    `export const FRESH_BOOT_DUMP = "";\n` +
    `export const FRESH_BOOT_SUPER_ADMIN_ROLE_ID = -1;\n` +
    `export const FRESH_BOOT_GITHUB_SYNC_COLUMNS: string[] = [];\n` +
    `export const FRESH_BOOT_SYSTEM_SETTINGS_COLUMNS: string[] = [];\n`,
);
