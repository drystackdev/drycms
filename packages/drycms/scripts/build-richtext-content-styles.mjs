/**
 * Generates `src/components/RichTextField/content-shadow-styles.ts` from
 * `src/styles/richtext-content.css`.
 *
 * RichTextField's editable surface renders inside its own shadow root (see
 * `useRichTextEditor.ts`), so its stylesheet has to be injected as a plain
 * `<style>` text node rather than loaded the way every other stylesheet in
 * this package is (an `@import` into `index.css`, part of the `dry.*`
 * cascade layers) - no bundler processes package assets (see CLAUDE.md), so
 * a plain file path wouldn't be reachable by the browser either. The `.css`
 * file stays the source of truth (readable, lintable, and directly
 * exported on its own via this package's own "./styles/*" export - see that
 * file's own header comment) - this script is what turns it into the
 * inlinable string the runtime actually uses.
 *
 * Run with: bun run build:richtext-styles
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = new URL("src/styles/richtext-content.css", root);
const target = new URL("src/components/RichTextField/content-shadow-styles.ts", root);

const css = readFileSync(fileURLToPath(source), "utf8");
// Backticks read fine in the .css file's own comments (this package's usual
// backtick-quoting convention) but have to be escaped once embedded in the
// generated template literal, or they'd end it early - same for "${", which
// would otherwise be read as interpolation.
const escaped = css.replace(/[`\\]/g, "\\$&").replace(/\$\{/g, "\\${");

const parts = [
  "/**",
  " * Generated from ../../styles/richtext-content.css by",
  " * scripts/build-richtext-content-styles.mjs - do not hand-edit. Run",
  " * `bun run build:richtext-styles` after changing that file instead.",
  " */",
  "export const richtextContentShadowStyles = `",
  escaped + "`;",
  "",
];

writeFileSync(fileURLToPath(target), parts.join("\n"));

console.log(`Generated ${fileURLToPath(target)} from ${fileURLToPath(source)}`);
