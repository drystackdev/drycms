import { dirname, join, relative } from "node:path";
import type { Plugin } from "vite";

const DRY_CALL = /\bdry\s*\(/;
const HAS_DRY_IMPORT = /import\s*\{[^}]*\bdry\b[^}]*\}\s*from\s*["'][^"']*dry-reader(\.js)?["']/;
const SOURCE_FILE = /\.(tsx?|jsx?)$/;

const DRY_READER_ABS_PATH = join(process.cwd(), "src/content-types/dry-reader.ts");

/**
 * Injects `import { dry } from ".../dry-reader.js"` into any
 * `src/apps/pages/**` module that calls `dry(` without importing it
 * itself - closes the gap `dry.generated.d.ts`'s header comment flags
 * ("Calling the ambient global `dry()` ... requires the Vite plugin ...
 * not implemented yet") that the same file's own
 * `declare global { function dry(): ... }` promises. Same shape as
 * `build-component-bundle.ts`'s `dryComponentFilenamePlugin` - a small,
 * regex-gated `transform` hook keyed by file path, not a full parser.
 */
export function dryGlobalPlugin(): Plugin {
  return {
    name: "dry-global",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?", 1)[0] ?? "";
      if (!file.includes("/src/apps/pages/")) return null;
      if (!SOURCE_FILE.test(file)) return null;
      if (!DRY_CALL.test(code)) return null;
      if (HAS_DRY_IMPORT.test(code)) return null;

      let specifier = relative(dirname(file), DRY_READER_ABS_PATH)
        .replace(/\.ts$/, ".js")
        .replace(/\\/g, "/");
      if (!specifier.startsWith(".")) specifier = `./${specifier}`;

      return {
        code: `import { dry } from ${JSON.stringify(specifier)};\n${code}`,
        map: null,
      };
    },
  };
}
