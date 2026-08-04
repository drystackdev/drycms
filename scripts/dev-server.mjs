import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";

/**
 * Dev entry - deliberately plain JS (not TypeScript): this is the one file
 * that has to run in Node *before* any Vite transform is available, since
 * it's the thing creating the Vite dev server in the first place. Every
 * other server file (`src/server/**`) is real TypeScript, loaded here via
 * `vite.ssrLoadModule` - the standard Vite "custom SSR server" pattern - so
 * none of it needs precompiling in dev. See `status/remove-astro.md`.
 */
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});

const { applySecurityHeaders, createApiMiddleware, toFetchRequest, sendFetchResponse } = await vite.ssrLoadModule("/src/server/adapters/node.js");
const { guardPageRequest } = await vite.ssrLoadModule("/src/server/page-guard.ts");
const { injectClientConfig } = await vite.ssrLoadModule("/src/server/client-config.ts");
const apiMiddleware = createApiMiddleware();

/**
 * Regenerates `src/apps/dry.generated.d.ts` (see `plans/reader.md`) once on
 * startup, so a fresh checkout has correct `dry()` types without a manual
 * step - `bun run dry:generate` (`scripts/dry-generate.ts`) covers the
 * mid-session case (schema changed, no restart) this can't. `content.engine
 * === "D1"` has no local binding to read here, same as that script - skipped
 * silently rather than logging a scary, expected error on every D1 dev
 * startup. Never fatal: a codegen bug must not block the dev server itself.
 */
try {
  const { content } = await vite.ssrLoadModule("/src/server/config.ts");
  if (content.engine !== "D1") {
    const { createContentEngineAdapter } = await vite.ssrLoadModule("/src/content-types/engine/index.ts");
    const { generateDryTypes } = await vite.ssrLoadModule("/src/content-types/codegen.ts");
    const adapter = createContentEngineAdapter(content);
    const allTypes = await adapter.listContentTypes();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(new URL("../src/apps/dry.generated.d.ts", import.meta.url), generateDryTypes(allTypes));
    console.log(`[drycms] generated dry.generated.d.ts (${allTypes.length} content types)`);
  }
} catch (error) {
  console.error("[drycms] failed to generate dry.generated.d.ts:", error);
}

const server = createHttpServer((req, res) => {
  apiMiddleware(req, res, () => {
    guardPageRequest(toFetchRequest(req), {}).then((redirect) => {
      if (redirect) return sendFetchResponse(redirect, res);
      vite.middlewares(req, res, async () => {
        try {
          const url = req.url ?? "/";
          let html = readFileSync("index.html", "utf8");
          html = await vite.transformIndexHtml(url, html);
          html = injectClientConfig(html);
          applySecurityHeaders(res);
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        } catch (error) {
          vite.ssrFixStacktrace(error);
          console.error(error);
          res.statusCode = 500;
          applySecurityHeaders(res);
          res.end("Internal server error");
        }
      });
    });
  });
});

const port = Number(process.env.PORT) || 5173;
server.listen(port, () => {
  console.log(`[drycms] dev server: http://localhost:${port}`);
});
