// Vite's `?url` suffix (typed by this repo's `vite/client` tsconfig
// `types` entry) resolves to the built/dev-served URL STRING for the
// target module instead of executing it - the standard, cross-dev/prod
// Vite mechanism for "give me a fetchable URL to this asset". This
// package's `package.json` `main`/`browser`/`exports` all point at the same
// single file, `dist/index.global.js` - a dependency-free IIFE/global
// build, literally built for drop-in `<script>` use, not an ESM entry a
// plain bare import would pull in and execute immediately in THIS document.
import tailwindBrowserScriptUrl from "@tailwindcss/browser?url";
import { minifyCss } from "./minify-css.js";

const GLOBALS_CSS_PATH = "styles/globals.css";

function resolveRelativeCssPath(fromPath: string, specifier: string): string {
  const parts = [...fromPath.split("/").slice(0, -1), ...specifier.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

/** Expands the live stylesheet graph into one browser-compiler input. The
 * browser package cannot fetch relative imports from the in-memory/R2 page
 * source store, so leaving `@import "./theme.css"` intact silently drops the
 * project's `@theme` tokens and therefore utilities such as `bg-primary`. */
function resolveTailwindStylesheets(sourceByPath: Record<string, string>): { source: string; paths: string[] } {
  const active = new Set<string>();
  const paths = new Set<string>();

  function expand(path: string): string {
    const source = sourceByPath[path];
    if (source === undefined) throw new Error(`[drycms] Missing Tailwind stylesheet "${path}".`);
    if (active.has(path)) throw new Error(`[drycms] Circular Tailwind stylesheet import at "${path}".`);
    active.add(path);
    paths.add(path);
    const expanded = source.replace(
      /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/g,
      (statement, specifier: string) => {
        if (!specifier.startsWith(".")) return statement;
        return expand(resolveRelativeCssPath(path, specifier));
      },
    );
    active.delete(path);
    return expanded;
  }

  return { source: expand(GLOBALS_CSS_PATH), paths: [...paths] };
}

export function tailwindStylesheetSource(sourceByPath: Record<string, string>): string {
  return resolveTailwindStylesheets(sourceByPath).source;
}

/** Every stylesheet whose source was actually folded into globals.css. */
export function tailwindStylesheetPaths(sourceByPath: Record<string, string>): string[] {
  return resolveTailwindStylesheets(sourceByPath).paths;
}

/**
 * Per-page Tailwind CSS compile (`plans/app-r2.md` mục 6) - runs
 * `@tailwindcss/browser` inside a FRESH, throwaway iframe per call, never
 * the admin tab's own document. Required, not a defensive choice: confirmed
 * live (Playwright, 2026-08-09, `status/app-r2-build.md`) that
 * `@tailwindcss/browser` is DOM-observation-only with no programmatic API,
 * AND that building page B right after page A in the SAME document leaks
 * page A's classes into page B's compiled CSS (`stillHasBgRed500FromPageA:
 * true` in that run) - a fresh iframe (its own realm, own module registry,
 * own `@tailwindcss/browser` instance) is the only isolation that actually
 * works, also confirmed live in that same run.
 *
 * `bodyHtml` should be the rendered page's `<body>` INNER html (the output
 * of `buildDocument`, minus the `<html>`/`<head>` wrapper) - only its class
 * usage matters, the iframe never navigates anywhere real.
 *
 * `extraScanText`, if given, is `sourceCandidateTokens()`-extracted and
 * dropped onto a hidden, inert element's `class` attribute alongside
 * `bodyHtml`. Necessary, not decorative: read `dist/index.global.js`
 * directly (there's no public API to hook into instead) and its ENTIRE
 * candidate-collection step is `document.querySelectorAll("[class]")` then
 * each match's `classList` - it never inspects text content, so a hidden
 * element carrying candidates as plain text is invisible to it; only a real
 * `class` attribute is ever read. `bodyHtml` alone is a ONE-SHOT server
 * render with every piece of client-only state (a menu's `open`, a tab's
 * active panel, ...) at its default - any utility class that only appears in
 * a JSX branch gated behind such state (`{open && <nav class="absolute
 * top-full ...">}`) never renders into that HTML, so it never gets compiled
 * CSS even though hydration later adds the class to the real DOM (confirmed
 * live 2026-08-15, `component/MobileMenu.tsx` on a real tenant: the class
 * was present on the opened element, `getComputedStyle` showed
 * `position: static` - no rule existed at all). Extracting candidate tokens
 * from this project's raw `.tsx` source text and forcing them onto a real
 * element sidesteps that, matching how a normal static Tailwind build
 * (scanning source files, not runtime DOM) already covers every conditional
 * branch regardless of whether this one render happened to hit it.
 */

/** Every `[class]="…"`/`cn(…)`/`@apply …` string in real source text is
 * embedded among JS/TS/JSX syntax this never has to parse: valid Tailwind
 * utility/variant characters (letters, digits, `-_:/.%#!*` plus `[]` for
 * arbitrary values) are extracted as run-length tokens, and anything else
 * (quotes, braces, whitespace, `=`, `<`, `>`, ...) is treated as a
 * separator. Produces plenty of tokens that are NOT real utilities
 * (`import`, `useState`, `preact/hooks`, ...) - harmless, since
 * `@tailwindcss/browser`'s own build step (`$t.build`, confirmed reading
 * `dist/index.global.js`) silently drops any candidate that doesn't resolve
 * to a real utility rather than erroring, the same tolerance a real static
 * Tailwind scan relies on. */
const CANDIDATE_TOKEN_RE = /[A-Za-z0-9_\-:/.%#!*[\]]+/g;

function sourceCandidateTokens(text: string): string[] {
  return text.match(CANDIDATE_TOKEN_RE) ?? [];
}
export async function compileTailwindCss(
  bodyHtml: string,
  stylesheetSource: string,
  extraScanText = "",
  timeoutMs = 2000,
): Promise<string> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  document.body.appendChild(iframe);

  try {
    // `contentDocument` can be momentarily unready immediately after
    // `appendChild` in some browsers - same small settle delay the spike
    // that validated this approach used.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("[drycms] compileTailwindCss: iframe has no contentDocument.");

    doc.body.innerHTML = bodyHtml;

    const candidateTokens = extraScanText ? sourceCandidateTokens(extraScanText) : [];
    if (candidateTokens.length > 0) {
      const scanNode = doc.createElement("div");
      scanNode.style.display = "none";
      // A real `class` attribute - see this function's own doc comment for
      // why nothing else (`textContent`, a `data-*` attribute, ...) is ever
      // read by the package's candidate-collection step.
      scanNode.className = candidateTokens.join(" ");
      doc.body.appendChild(scanNode);
    }

    // Added BEFORE the package imports - confirmed live that a tag added
    // AFTER import never gets picked up (the package's styleObserver binds
    // to whatever `<style type="text/tailwindcss">` tags exist at import
    // time, not ones added later).
    const styleTag = doc.createElement("style");
    styleTag.setAttribute("type", "text/tailwindcss");
    styleTag.textContent = stylesheetSource;
    const before = new Set(doc.head.querySelectorAll("style"));
    doc.head.appendChild(styleTag);
    before.add(styleTag);

    // Imported INTO the iframe's own realm via an injected module script -
    // a normal `import()` from this module runs with THIS document as the
    // active one; ESM imports have no "which document" argument, so this
    // is the only way to actually get an independent instance per build.
    const absoluteScriptUrl = new URL(tailwindBrowserScriptUrl, window.location.origin).href;
    const script = doc.createElement("script");
    script.type = "module";
    script.textContent = `import ${JSON.stringify(absoluteScriptUrl)};`;
    doc.head.appendChild(script);

    const start = Date.now();
    let compiled: HTMLStyleElement | null = null;
    while (Date.now() - start < timeoutMs) {
      compiled = (Array.from(doc.head.querySelectorAll("style")).find((el) => !before.has(el)) as HTMLStyleElement | undefined) ?? null;
      if (compiled) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return minifyCss(compiled?.textContent ?? "");
  } finally {
    document.body.removeChild(iframe);
  }
}
