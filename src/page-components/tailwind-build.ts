// Vite's `?url` suffix (typed by this repo's `vite/client` tsconfig
// `types` entry) resolves to the built/dev-served URL STRING for the
// target module instead of executing it - the standard, cross-dev/prod
// Vite mechanism for "give me a fetchable URL to this asset". This
// package's `package.json` `main`/`browser`/`exports` all point at the same
// single file, `dist/index.global.js` - a dependency-free IIFE/global
// build, literally built for drop-in `<script>` use, not an ESM entry a
// plain bare import would pull in and execute immediately in THIS document.
import tailwindBrowserScriptUrl from "@tailwindcss/browser?url";

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
 */
export async function compileTailwindCss(bodyHtml: string, timeoutMs = 2000): Promise<string> {
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

    // Added BEFORE the package imports - confirmed live that a tag added
    // AFTER import never gets picked up (the package's styleObserver binds
    // to whatever `<style type="text/tailwindcss">` tags exist at import
    // time, not ones added later).
    const styleTag = doc.createElement("style");
    styleTag.setAttribute("type", "text/tailwindcss");
    styleTag.textContent = '@import "tailwindcss";';
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
    return compiled?.textContent ?? "";
  } finally {
    document.body.removeChild(iframe);
  }
}
