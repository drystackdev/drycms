/**
 * Shrinks a compiled CSS string by stripping comments and collapsing
 * whitespace outside quoted strings - `tailwind-build.ts`'s
 * `compileTailwindCss` returns `@tailwindcss/browser`'s own pretty-printed
 * output verbatim (that package is DOM-observation-only, no minify option
 * anywhere in its API), so nothing upstream ever shrinks it.
 *
 * A single-pass character scan, not a blind `css.replace(/\s+/g, " ")` -
 * that would also collapse whitespace INSIDE quoted values
 * (`content: "a b"`, `url("data:image/svg+xml,...")`) where it's
 * meaningful. Pure string operations, no Node built-ins - same constraint
 * `minify-js.ts` documents for `terser`: `compileTailwindCss` runs in the
 * admin's own browser tab (a throwaway iframe), not on the server.
 */
export function minifyCss(css: string): string {
  let result = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;

    if (quote) {
      result += ch;
      if (ch === "\\") result += css[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      result += ch;
      continue;
    }

    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }

    if (/\s/.test(ch)) {
      let j = i;
      while (j < css.length && /\s/.test(css[j]!)) j++;
      const prev = result[result.length - 1];
      const next = css[j];
      const dropsWhitespace = (c: string | undefined) => c !== undefined && "{};:,".includes(c);
      if (prev !== undefined && next !== undefined && !dropsWhitespace(prev) && !dropsWhitespace(next)) {
        result += " ";
      }
      i = j - 1;
      continue;
    }

    result += ch;
  }

  return result.trim();
}
