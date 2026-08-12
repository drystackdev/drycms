import type { Options } from "prettier";

/** Matches `EditerProps.language` - `"md"` maps to Prettier's `"markdown"` parser below. */
export type EditerFormatLanguage = "tsx" | "css" | "md";

export interface EditerFormatResult {
  code: string;
  /** Where the cursor should land in `code` - Prettier's own cursor-tracking
   * (`formatWithCursor`), so a reflow doesn't leave the caret in an
   * unrelated spot the way "restart at 0" or "leave it at the old offset"
   * would once whitespace shifts everything after it. */
  cursorOffset: number;
}

/** Plugins are dynamically imported (not top-level) so the ~1-2MB combined
 * parser weight (`typescript.js` alone is 880KB unminified - it vendors its
 * own copy of the TS compiler, separate from the `typescript` package
 * `ts-worker.ts` already runs) only loads the first time a user actually
 * formats something, not on every `Editer` mount. */
async function loadPlugins(language: EditerFormatLanguage): Promise<Pick<Options, "parser" | "plugins" | "proseWrap">> {
  if (language === "tsx") {
    const [typescript, estree] = await Promise.all([import("prettier/plugins/typescript"), import("prettier/plugins/estree")]);
    return { parser: "typescript", plugins: [typescript, estree] };
  }
  if (language === "css") {
    const postcss = await import("prettier/plugins/postcss");
    return { parser: "css", plugins: [postcss] };
  }
  const markdown = await import("prettier/plugins/markdown");
  // Prettier's own default (`proseWrap: "preserve"`) leaves prose exactly as
  // typed - a long paragraph stays one long line forever. `md/` (`MD_ROOT`)
  // is AI-context documentation meant to be read/edited in a narrow editor
  // pane, so wrap it at `printWidth` like the rest of this file's output,
  // instead of only reformatting blank lines/list markers.
  return { parser: "markdown", plugins: [markdown], proseWrap: "always" };
}

/** Pretty-prints `code` with Prettier - real line-wrapping (long JSX props,
 * object literals, etc. onto multiple lines), unlike the TS Language
 * Service's own formatter this replaced (whitespace/indentation only, never
 * reflows a line). `cursorOffset` defaults to 0 (the save-on-format path
 * doesn't have a live cursor to preserve); `Editer`'s own `Shift+Alt+F`
 * handler passes the real one. Falls back to returning `code` unchanged
 * (cursor untouched) on a parse error - formatting is a nicety, never worth
 * blocking a save or clobbering the buffer over. */
export async function formatCode(code: string, language: EditerFormatLanguage, cursorOffset = 0): Promise<EditerFormatResult> {
  try {
    const [{ formatWithCursor }, options] = await Promise.all([import("prettier/standalone"), loadPlugins(language)]);
    const result = await formatWithCursor(code, { ...options, cursorOffset });
    return { code: result.formatted, cursorOffset: result.cursorOffset };
  } catch {
    return { code, cursorOffset };
  }
}
